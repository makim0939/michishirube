import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db } from '../data/db'
import { compressPhoto, inMemory, makePoster } from '../data/mediaPrep'
import { addRecord, deleteRecord, lastNextAction, updateRecord, type NewMedia } from '../data/repo'
import type { Media, Outcome } from '../domain/types'
import { ConfirmButton, Empty, formatAgo, formatBytes, isVideo, MediaView, requestPersist } from './common'
import { useAction, useToast } from './feedback'
import { canRecordInApp, Recorder } from './Recorder'
import { ReferenceList } from './References'
import { backHandler, goBack, href } from './router'
import { readStorage, removeStorage, writeStorage } from './storage'
import { Trimmer } from './Trimmer'

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: 'good', label: '◎ 成功' },
  { value: 'meh', label: '△ 惜しい' },
  { value: 'bad', label: '✕ 失敗' },
]

// 書きかけのメモは、カメラから戻ったときにページが再読み込みされても残るようにする
type Draft = { reason?: string; nextAction?: string }

function useDraft(key: string, enabled: boolean) {
  const [draft, setDraft] = useState<Draft>(() => {
    if (!enabled) return {}
    try {
      return JSON.parse(readStorage('session', key) ?? '{}') as Draft
    } catch {
      return {}
    }
  })
  useEffect(() => {
    if (enabled) writeStorage('session', key, JSON.stringify(draft))
  }, [key, draft, enabled])
  return [draft, setDraft, () => removeStorage('session', key)] as const
}

/** 画面に並べる動画・写真。新しく撮ったものと、保存済みの記録にあるもの */
type Item =
  | { kind: 'new'; key: string; file: File; poster?: Blob }
  | { kind: 'existing'; key: string; media: Media; replaced?: { file: File; poster?: Blob } }

function itemBlob(item: Item): Blob | undefined {
  if (item.kind === 'new') return item.file
  return item.replaced?.file ?? item.media.blob
}

function itemType(item: Item): string {
  return item.kind === 'new' ? item.file.type : (item.replaced?.file.type ?? item.media.type)
}

/** File をメモリ上のコピーにする（名前と種類は残す） */
async function detach(file: File): Promise<File> {
  return new File([await inMemory(file)], file.name, { type: file.type })
}

let keySeq = 0
const nextKey = () => `item-${++keySeq}`

/**
 * 記録する画面。recordId があれば、保存した記録を直す
 */
export function RecordScreen({ skillId, recordId }: { skillId: string; recordId?: string }) {
  const editing = !!recordId
  const run = useAction()
  const toast = useToast()
  const data = useLiveQuery(async () => {
    const skill = await db.skills.get(skillId)
    return {
      skill,
      next: skill && !editing ? await lastNextAction(skillId) : undefined,
      count: await db.records.where('skillId').equals(skillId).count(),
    }
  }, [skillId, editing])

  const [items, setItems] = useState<Item[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [outcome, setOutcome] = useState<Outcome>()
  const [draft, setDraft, clearDraft] = useDraft(`michishirube:draft:${skillId}`, !editing)
  const [loaded, setLoaded] = useState(!editing)
  const [missing, setMissing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [recording, setRecording] = useState(false)
  const [trimming, setTrimming] = useState<string | null>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)

  // 直すときは、保存した内容を一度だけ読み込む（同期で書き換わっても、入力中の内容を上書きしない）
  useEffect(() => {
    if (!recordId) return
    let cancelled = false
    void (async () => {
      const record = await db.records.get(recordId)
      if (cancelled) return
      if (!record) {
        setMissing(true)
        return
      }
      const media = (await db.media.bulkGet(record.mediaIds)).filter((m): m is Media => !!m)
      if (cancelled) return
      setOutcome(record.outcome)
      setDraft({ reason: record.reason, nextAction: record.nextAction })
      setItems(media.map((m) => ({ kind: 'existing' as const, key: nextKey(), media: m })))
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [recordId, setDraft])

  if (!data || !loaded) return missing ? <Empty>記録が見つかりません。</Empty> : null
  const { skill, next, count } = data
  if (!skill) return <Empty>スキルが見つかりません。</Empty>

  const fallback = editing ? `/skill/${skillId}` : '/'
  const hasNewMedia = items.some((i) => i.kind === 'new' || (i.kind === 'existing' && i.replaced))
  const unsaved = editing ? dirty : items.length > 0

  const change = () => setDirty(true)

  /** 動画のサムネイルは後から作って付ける（撮ってすぐ一覧に出す） */
  const attachPoster = (key: string, file: File) => {
    void makePoster(file).then((poster) => {
      if (!poster) return
      setItems((prev) =>
        prev.map((i) => {
          if (i.key !== key) return i
          if (i.kind === 'new' && i.file === file) return { ...i, poster }
          if (i.kind === 'existing' && i.replaced?.file === file) return { ...i, replaced: { file, poster } }
          return i
        }),
      )
    })
  }

  const addFiles = async (list: FileList | File[] | null) => {
    // FileList は input の value を空にすると中身も消えるので、先に配列へ写す
    const picked = list ? Array.from(list) : []
    if (picked.length === 0) return
    // 写真は縮小してから持つ（端末の容量と同期の量を抑える）
    const prepared = await Promise.all(picked.map((f) => (f.type.startsWith('image/') ? compressPhoto(f) : f)))
    const added = prepared.map((file) => ({ kind: 'new' as const, key: nextKey(), file }))
    setItems((prev) => [...prev, ...added])
    change()
    for (const a of added) if (a.file.type.startsWith('video/')) attachPoster(a.key, a.file)
  }

  const removeItem = (item: Item) => {
    setItems((prev) => prev.filter((i) => i.key !== item.key))
    if (item.kind === 'existing') setRemoved((prev) => [...prev, item.media.id])
    change()
  }

  const onTrimmed = (key: string, file: File) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.key !== key) return i
        return i.kind === 'new' ? { ...i, file, poster: undefined } : { ...i, replaced: { file } }
      }),
    )
    setTrimming(null)
    change()
    attachPoster(key, file)
  }

  const save = () =>
    run(async () => {
      setSaving(true)
      try {
        const reason = draft.reason ?? ''
        const nextAction = draft.nextAction ?? ''
        const added: NewMedia[] = []
        const replace: ({ id: string } & NewMedia)[] = []
        for (const i of items) {
          if (i.kind === 'new') added.push({ blob: await detach(i.file), poster: i.poster })
          else if (i.replaced) replace.push({ id: i.media.id, blob: await detach(i.replaced.file), poster: i.replaced.poster })
        }
        if (recordId) {
          await updateRecord({ recordId, outcome, reason, nextAction, addFiles: added, removeMediaIds: removed, replace })
          toast.show('記録を直しました')
        } else {
          await addRecord({ skillId, outcome, reason, nextAction, files: added })
          clearDraft()
          toast.show('記録しました')
        }
        if (hasNewMedia) void requestPersist()
        goBack(fallback)
      } finally {
        setSaving(false)
      }
    })

  const trimItem = items.find((i) => i.key === trimming)
  const trimBlob = trimItem && itemBlob(trimItem)

  return (
    <div className="screen record-screen">
      <header className="screen-header">
        <a
          className="back"
          href={href(fallback)}
          onClick={(e) => {
            // 撮った動画・写真や直した内容は、ここで保存しないと消えるので、黙って戻らない
            if (unsaved) {
              e.preventDefault()
              setConfirmLeave(true)
            } else {
              backHandler(fallback)(e)
            }
          }}
          aria-label="戻る"
        >
          ←
        </a>
        <div className="title-block">
          {editing && <span className="muted">記録を直す</span>}
          <h1>{skill.name}</h1>
        </div>
      </header>

      {confirmLeave && (
        <div className="confirm">
          <p>
            {editing
              ? '直した内容が保存されていません。保存せずに戻りますか？'
              : `撮った動画・写真が ${items.length} 件あります。保存せずに戻ると消えます。`}
          </p>
          <div className="row">
            <button className="btn danger" onClick={() => goBack(fallback)}>
              保存せずに戻る
            </button>
            <button className="btn" onClick={() => setConfirmLeave(false)}>
              {editing ? '直すのを続ける' : '記録を続ける'}
            </button>
          </div>
        </div>
      )}

      {!editing && (
        <>
          <div className={`next-action big ${next ? '' : 'none'}`}>
            <span className="next-label">前回の次の一手{next && `（${formatAgo(next.at)}）`}</span>
            <span className="next-text">{next ? next.text : 'まだありません'}</span>
          </div>
          {count > 0 && (
            <a className="link-row" href={href(`/skill/${skillId}`)}>
              過去の記録を見る（{count}件）→
            </a>
          )}
        </>
      )}

      {skill.references.length > 0 && (
        <details className="criteria-details" open={!editing}>
          <summary>参考資料</summary>
          <ReferenceList skill={skill} compact />
        </details>
      )}

      {skill.criteria && (
        <details className="criteria-details">
          <summary>達成条件</summary>
          <p>{skill.criteria}</p>
        </details>
      )}

      <section className="section">
        <div className="capture-buttons">
          <button
            type="button"
            className="btn capture"
            onClick={() => (canRecordInApp() ? setRecording(true) : videoInput.current?.click())}
          >
            <span aria-hidden="true">🎥</span>動画を撮る
          </button>
          <button type="button" className="btn capture" onClick={() => photoInput.current?.click()}>
            <span aria-hidden="true">📷</span>写真を撮る
          </button>
          <button type="button" className="btn capture" onClick={() => libraryInput.current?.click()}>
            <span aria-hidden="true">🖼️</span>アルバム
          </button>
        </div>
        {[
          { ref: videoInput, accept: 'video/*', capture: true, multiple: false },
          { ref: photoInput, accept: 'image/*', capture: true, multiple: false },
          { ref: libraryInput, accept: 'image/*,video/*', capture: false, multiple: true },
        ].map((input) => (
          <input
            key={input.accept + String(input.capture)}
            ref={input.ref}
            hidden
            type="file"
            accept={input.accept}
            {...(input.capture ? { capture: 'environment' as const } : {})}
            multiple={input.multiple}
            onChange={(e) => {
              void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        ))}
        {items.length > 0 && (
          <ul className="previews">
            {items.map((item) => {
              const blob = itemBlob(item)
              const type = itemType(item)
              const poster = item.kind === 'new' ? item.poster : (item.replaced?.poster ?? item.media.poster)
              return (
                <li key={item.key}>
                  {blob ? (
                    <MediaView
                      blob={blob}
                      type={type}
                      poster={poster}
                      cacheKey={`${item.key}-${blob.size}`}
                      autoLoad={item.kind === 'new' || !!item.replaced}
                    />
                  ) : (
                    <div className="media placeholder">この端末にはありません</div>
                  )}
                  <button type="button" className="remove" aria-label="外す" onClick={() => removeItem(item)}>
                    ×
                  </button>
                  <div className="preview-actions">
                    {blob && <span className="muted">{formatBytes(blob.size)}</span>}
                    {blob && isVideo({ type }) && (
                      <button type="button" className="btn small" onClick={() => setTrimming(item.key)}>
                        ✂ 切り取る
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {editing && items.some((i) => i.kind === 'existing' && i.replaced && i.media.youtubeId) && (
          <p className="muted small">
            切り取った動画は YouTube に上げ直します。前の動画は YouTube に残るので、不要なら YouTube アプリで削除してください。
          </p>
        )}
      </section>

      <section className="section">
        <div className="segmented" role="radiogroup" aria-label="結果">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={outcome === o.value}
              className={outcome === o.value ? `selected outcome-${o.value}` : ''}
              onClick={() => {
                setOutcome(outcome === o.value ? undefined : o.value)
                change()
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        <label className="field">
          <span>なぜそうなった？</span>
          <textarea
            rows={3}
            value={draft.reason ?? ''}
            onChange={(e) => {
              setDraft((d) => ({ ...d, reason: e.target.value }))
              change()
            }}
            placeholder="例：ミルクが熱すぎて泡が粗くなった（キーボードのマイクで音声入力できます）"
          />
        </label>
        <label className="field">
          <span>次の一手</span>
          <textarea
            rows={2}
            value={draft.nextAction ?? ''}
            onChange={(e) => {
              setDraft((d) => ({ ...d, nextAction: e.target.value }))
              change()
            }}
            placeholder="例：60℃で止める。次回の記録画面の一番上に出ます"
          />
        </label>
      </section>

      {editing && (
        <section className="section danger-zone">
          <ConfirmButton
            className="btn ghost"
            confirmLabel="削除する"
            message="この記録と動画・写真を削除します。元に戻せません。YouTube に上げた動画は残ります。"
            onConfirm={async () => {
              const ok = await run(async () => {
                await deleteRecord(recordId)
                return true
              })
              if (ok) {
                toast.show('記録を削除しました')
                goBack(fallback)
              }
            }}
          >
            この記録を削除
          </ConfirmButton>
        </section>
      )}

      {recording && (
        <Recorder
          onDone={(file) => {
            setRecording(false)
            void addFiles([file])
          }}
          onClose={() => setRecording(false)}
          onFallback={() => {
            setRecording(false)
            videoInput.current?.click()
          }}
        />
      )}

      {trimItem && trimBlob && (
        <Trimmer
          file={trimBlob}
          name={trimItem.kind === 'new' ? trimItem.file.name : (trimItem.media.name ?? 'video.mp4')}
          onDone={(file) => onTrimmed(trimItem.key, file)}
          onClose={() => setTrimming(null)}
        />
      )}

      <div className="sticky-actions">
        <button className="btn primary block" disabled={saving || (editing && !dirty)} onClick={save}>
          {saving ? '保存中…' : editing ? '直した内容を保存' : '保存する'}
        </button>
      </div>
    </div>
  )
}

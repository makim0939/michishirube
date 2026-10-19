import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { contentBlob } from '../data/content'
import { db } from '../data/db'
import { compressPhoto, inMemory, makePoster, type Poster } from '../data/mediaPrep'
import { addRecord, deleteRecord, lastNextAction, updateRecord, type NewMedia } from '../data/repo'
import { getVideoSettings, type VideoQuality, type YoutubePrivacy } from '../data/videoStorage'
import { isAndroidApp } from '../platform'
import { causeTip, LATTE_CAUSES } from '../domain/causes'
import { OUTCOME_LABEL } from '../domain/format'
import { sortByDepth } from '../domain/logic'
import type { Media, Outcome } from '../domain/types'
import { ConfirmButton, Empty, formatBytes, isVideo, MediaView, requestPersist, splitName } from './common'
import { useCupImageUrl } from './cupImage'
import { useAction, useToast } from './feedback'
import { canRecordInApp, Recorder } from './Recorder'
import { backHandler, go, goBack, href } from './router'
import { readStorage, removeStorage, writeStorage } from './storage'
import { SkillPicker } from './SkillPicker'
import { Trimmer } from './Trimmer'
import { useBackHandler } from './useBackHandler'
import { patternFor } from './world'
import { BackIcon, CameraIcon, ChevronDownIcon, PhotoIcon, PlusIcon, ScissorsIcon, VideoIcon } from './icons'

const OUTCOMES: { value: Outcome; label: string }[] = (['good', 'meh', 'bad'] as const).map((value) => ({
  value,
  label: OUTCOME_LABEL[value],
}))

// 書きかけのメモは、カメラから戻ったときにページが再読み込みされても残るようにする
// skillId は、記録の途中で選び直した型（route の型と違うとき）
type Draft = { skillId?: string; reason?: string; nextAction?: string; causes?: string[] }

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

/** 編集で、端末に中身が無い動画・写真。写真はサーバーから取り、YouTube にある動画はその絵と、編集できないことを出す */
function NotOnDevice({ media }: { media: Media }) {
  const url = useCupImageUrl(media, 'edit')
  if (!url) return <div className="media placeholder">この端末にはありません</div>
  if (!isVideo(media)) return <img className="media" src={url} alt="" />
  return (
    <div className="media placeholder with-poster" style={{ backgroundImage: `url(${url})` }}>
      {media.youtubeId ? 'YouTube にあります' : 'この端末にはありません'}
      <small>端末に無いので、切り取りなどの編集はできません</small>
    </div>
  )
}

/** 画面に並べる動画・写真。新しく撮ったものと、保存済みの記録にあるもの */
type Item =
  | {
      kind: 'new'
      key: string
      file: File
      poster?: Poster
      inMemory: boolean
      /** アプリのカメラで撮ったときの画質（アルバムから入れた動画は無い） */
      quality?: VideoQuality
      /** この動画だけ、YouTube に上げる公開範囲を変えたとき（変えなければ、設定のとおり） */
      privacy?: YoutubePrivacy
    }
  | { kind: 'existing'; key: string; media: Media; replaced?: { file: File; poster?: Poster } }

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

/** Android でアルバムから入れられる動画の大きさ（4K でも1分ほど）。超えるとメモリに写すときにアプリが落ちることがある */
const ANDROID_MAX_PICK_BYTES = 400 * 1024 * 1024

let keySeq = 0
const nextKey = () => `item-${++keySeq}`

/**
 * 記録する画面。recordId があれば、保存した記録を編集する
 */
export function RecordScreen({ skillId: routeSkillId, recordId }: { skillId: string; recordId?: string }) {
  const editing = !!recordId
  const run = useAction()
  const toast = useToast()
  const videoSettings = useLiveQuery(getVideoSettings)
  const storage = videoSettings?.storage
  // 型は、同じ分野の中から選び直せる（練習の途中で、描く型を変えることがある）
  const skills = useLiveQuery(async () => {
    const first = await db.skills.get(routeSkillId)
    return first ? sortByDepth(await db.skills.where('domainId').equals(first.domainId).toArray()) : []
  }, [routeSkillId])
  const [draft, setDraft, clearDraft] = useDraft(`michishirube:draft:${routeSkillId}`, !editing)
  // 下書きの型が、もう無いとき（削除・同期で消えた）は、URL の型に戻す（画面から抜けられなくならないように）
  const skillId = draft.skillId && skills?.some((s) => s.id === draft.skillId) ? draft.skillId : routeSkillId
  const skill = skills?.find((s) => s.id === skillId)
  const stats = useLiveQuery(
    async () => ({
      next: !editing ? await lastNextAction(skillId) : undefined,
      count: await db.records.where('skillId').equals(skillId).count(),
    }),
    [skillId, editing],
  )
  // 型を選び直した瞬間に、画面が空にならないよう、読み直しの間は前の値を使う
  const lastStats = useRef(stats)
  if (stats) lastStats.current = stats
  const shownStats = stats ?? lastStats.current
  const data = skills && shownStats ? { skills, ...shownStats } : undefined
  // 直す記録の、もとの型（保存したときに、型を変えたか調べるため。URL の型は、履歴の古い URL だと違うことがある）
  const originalSkillId = useRef<string | undefined>(undefined)
  // 型だけを選んで何も書かずに離れたら、その選びは残さない（次に同じ型の記録を開いたとき、別の型で開いてしまうため）。
  // ページの再読み込み（カメラから戻るとき）では、この後始末は走らないので、書きかけは残る
  const latestDraft = useRef(draft)
  latestDraft.current = draft
  useEffect(
    () => () => {
      const d = latestDraft.current
      if (!editing && !d.reason?.trim() && !d.nextAction?.trim() && !(d.causes?.length ?? 0)) {
        removeStorage('session', `michishirube:draft:${routeSkillId}`)
      }
    },
    [editing, routeSkillId],
  )

  const [items, setItems] = useState<Item[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [outcome, setOutcome] = useState<Outcome>()
  const [loaded, setLoaded] = useState(!editing)
  const [missing, setMissing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  /** 保存せずに離れようとしたときの行き先（null なら確認を出していない） */
  const [confirmLeave, setConfirmLeave] = useState<{ back: true } | { to: string } | null>(null)
  const [recording, setRecording] = useState(false)
  const [trimming, setTrimming] = useState<string | null>(null)
  const [pickingSkill, setPickingSkill] = useState(false)
  const videoInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  /** 理由のメモ欄を開いている（書いてあれば最初から開く） */
  const [memoOpen, setMemoOpen] = useState(false)
  const autoOpened = useRef(false)

  // 新しく記録するときは、すぐカメラを開く（撮ってから結果を付ける。注ぐ前に見たい「次の一手」はカメラの上に出す）
  useEffect(() => {
    if (editing || autoOpened.current || !skill) return
    autoOpened.current = true
    if (canRecordInApp()) setRecording(true)
  }, [editing, skill])

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
      const rows = (await db.media.bulkGet(record.mediaIds)).filter((m): m is Media => !!m)
      // アプリでは中身がファイルにあるので、切り取りなどで使えるよう読み込んでおく（保存はしない）
      const media = await Promise.all(
        rows.map(async (m) => (m.file && !m.blob ? { ...m, blob: await contentBlob(m).catch(() => undefined) } : m)),
      )
      if (cancelled) return
      originalSkillId.current = record.skillId
      setOutcome(record.outcome)
      setDraft({ skillId: record.skillId, reason: record.reason, nextAction: record.nextAction, causes: record.causes })
      setItems(media.map((m) => ({ kind: 'existing' as const, key: nextKey(), media: m })))
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [recordId, setDraft])

  // 結果・原因・次の一手・メモのどれかを入れてある（空白だけは入れていないのと同じ。保存の条件と同じ数え方）
  const hasInput =
    !!outcome || !!draft.reason?.trim() || !!draft.nextAction?.trim() || (draft.causes?.length ?? 0) > 0
  // 新しい記録は、動画・写真か入力が1つでもあれば残す価値がある（無いまま戻ると何も失わない）
  const unsaved = editing ? dirty : items.length > 0 || hasInput

  // Android の「戻る」（ボタン・端からのスワイプ）。画面の「<」と同じく、保存前の内容は黙って捨てずに確認を出す。
  // 確認が出ているときの「戻る」は、確認を閉じて続ける。カメラ・編集・型の選択は、それぞれが先に受け止める
  useBackHandler(() => {
    if (confirmLeave) {
      setConfirmLeave(null)
      return true
    }
    if (unsaved) {
      setConfirmLeave({ back: true })
      return true
    }
    return false
  })

  if (!data || !loaded) return missing ? <Empty>記録が見つかりません。</Empty> : null
  const { next, count } = data
  if (!skill) return <Empty>型が見つかりません。</Empty>

  const fallback = editing ? `/skill/${skillId}` : '/'
  // ラテアートの型では、うまくいかなかった原因をワンタップで選べる
  const causeOptions: readonly string[] = patternFor(skill.name) ? LATTE_CAUSES : []
  const hasNewMedia = items.some((i) => i.kind === 'new' || (i.kind === 'existing' && i.replaced))
  // 新しい記録で、まだ何も無い（保存しても「何か入れてください」になるだけなので、押せないようにする）
  const nothingToSave = !editing && items.length === 0 && !hasInput

  const change = () => setDirty(true)

  /** 型を選び直す。原因の選択肢は型ごとなので、選べなくなる型へ移るときは、選んでいた原因を外す */
  const pickSkill = (id: string) => {
    setPickingSkill(false)
    if (id === skillId) return
    const target = skills?.find((s) => s.id === id)
    setDraft((d) => ({ ...d, skillId: id, ...(target && patternFor(target.name) ? {} : { causes: undefined }) }))
    change()
  }

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

  /** inMemory：アプリ内の録画のように、もともとメモリ上にあるファイル */
  const addFiles = async (list: FileList | File[] | null, inMemory = false, quality?: VideoQuality) => {
    // FileList は input の value を空にすると中身も消えるので、先に配列へ写す
    let picked = list ? Array.from(list) : []
    // Android はメモリに写すので、大きすぎる動画は入れない（アプリが落ちないように）
    if (isAndroidApp && picked.some((f) => f.type.startsWith('video/') && f.size > ANDROID_MAX_PICK_BYTES)) {
      picked = picked.filter((f) => !(f.type.startsWith('video/') && f.size > ANDROID_MAX_PICK_BYTES))
      toast.show('長すぎる動画は入れられません。写真アプリで短く切り取ってから選んでください', 'error')
    }
    if (picked.length === 0) return
    // 写真は縮小してから持つ（端末の容量と同期の量を抑える）。
    // Android は、選んだファイルを少したつと読めなくなる（読む許可が切れる）ので、動画もすぐメモリに写す
    const prepared = await Promise.all(
      picked.map((f) => (f.type.startsWith('image/') ? compressPhoto(f) : isAndroidApp ? detach(f) : f)),
    )
    // 縮小した写真もメモリ上に作り直したもの
    const added = prepared.map((file, i) => ({
      kind: 'new' as const,
      key: nextKey(),
      file,
      inMemory: inMemory || file !== picked[i],
      // 撮った画質は、動画だけに付ける
      ...(quality && file.type.startsWith('video/') ? { quality } : {}),
    }))
    setItems((prev) => [...prev, ...added])
    change()
    for (const a of added) if (a.file.type.startsWith('video/')) attachPoster(a.key, a.file)
  }

  const removeItem = (item: Item) => {
    setItems((prev) => prev.filter((i) => i.key !== item.key))
    if (item.kind === 'existing') setRemoved((prev) => [...prev, item.media.id])
    change()
  }

  /** この動画だけ、YouTube に上げる公開範囲を切り替える（初めは設定のとおり） */
  const togglePrivacy = (item: Item) => {
    if (item.kind !== 'new') return
    const next: YoutubePrivacy = (item.privacy ?? videoSettings?.youtubePrivacy) === 'public' ? 'unlisted' : 'public'
    setItems((prev) => prev.map((i) => (i.key === item.key && i.kind === 'new' ? { ...i, privacy: next } : i)))
    change()
    toast.show(next === 'public' ? 'この動画は、公開で YouTube に上げます' : 'この動画は、限定公開で YouTube に上げます')
  }

  const onTrimmed = (key: string, file: File) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.key !== key) return i
        return i.kind === 'new' ? { ...i, file, poster: undefined, inMemory: true } : { ...i, replaced: { file } }
      }),
    )
    setTrimming(null)
    change()
    attachPoster(key, file)
  }

  /** more：保存したら、続けて次の杯を撮る */
  const save = (more = false) =>
    run(async () => {
      setSaving(true)
      try {
        const reason = draft.reason ?? ''
        const nextAction = draft.nextAction ?? ''
        // 原因は、△✕のときだけ選べる。書きかけから戻ったとき、結果だけ消えて原因が見えないまま残っても、保存はしない
        const causes = editing || outcome === 'meh' || outcome === 'bad' ? (draft.causes ?? []) : []
        const added: NewMedia[] = []
        const replace: ({ id: string } & NewMedia)[] = []
        for (const i of items) {
          // 切り取った動画は、もともとメモリ上にある
          if (i.kind === 'new')
            added.push({
              blob: i.inMemory ? i.file : await detach(i.file),
              poster: i.poster?.blob,
              posterEnd: i.poster?.end,
              quality: i.quality,
              youtubePrivacy: i.privacy,
            })
          else if (i.replaced)
            replace.push({
              id: i.media.id,
              blob: i.replaced.file,
              poster: i.replaced.poster?.blob,
              posterEnd: i.replaced.poster?.end,
            })
        }
        if (recordId) {
          await updateRecord({
            recordId,
            skillId,
            outcome,
            reason,
            causes,
            nextAction,
            addFiles: added,
            removeMediaIds: removed,
            replace,
          })
          toast.show(skillId === (originalSkillId.current ?? routeSkillId) ? '記録を保存しました' : `「${splitName(skill.name).main}」に移して保存しました`)
        } else {
          await addRecord({ skillId, outcome, reason, causes, nextAction, files: added })
          clearDraft()
          const total = await db.records.count()
          if (more) {
            // 続けて淹れる：この画面のまま中身を空にして、すぐカメラを開く
            toast.show(`No.${total} を記録しました`)
            setItems([])
            setOutcome(undefined)
            // 型を変えて描き直したなら、続けて同じ型で撮ることが多いので、型は残す
            setDraft(skillId === routeSkillId ? {} : { skillId })
            setMemoOpen(false)
            window.scrollTo(0, 0)
            if (canRecordInApp()) setRecording(true)
            if (hasNewMedia) void requestPersist()
            return
          }
          toast.show(`No.${total} を記録しました`, 'ok', { label: 'もう1杯', onClick: () => go(`/record/${skillId}`) })
        }
        if (hasNewMedia) void requestPersist()
        goBack(fallback)
      } finally {
        setSaving(false)
      }
    })

  const trimItem = items.find((i) => i.key === trimming)
  const trimBlob = trimItem && itemBlob(trimItem)

  // 次の一手の候補：前回と同じ、選んだ原因の直し方（押すだけで入る）
  const suggestions = [
    ...(next && !editing ? [{ prefix: '前回', text: next.text }] : []),
    ...(draft.causes ?? []).flatMap((c) => {
      const tip = causeTip(c)
      return tip ? [{ prefix: c, text: tip }] : []
    }),
  ].filter((sgt, i, all) => all.findIndex((x) => x.text === sgt.text) === i && sgt.text !== draft.nextAction)
  const showMemo = memoOpen || !!draft.reason
  const openCamera = () => (canRecordInApp() ? setRecording(true) : videoInput.current?.click())

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
              setConfirmLeave({ back: true })
            } else {
              backHandler(fallback)(e)
            }
          }}
          aria-label="戻る"
        >
          <BackIcon size={26} />
        </a>
        <div className="title-block">
          {editing ? <span className="muted">記録を編集</span> : <span className="muted">{count + 1}杯目</span>}
          <h1>
            {/* 同じ分野に別の型があるときは、名前を押して選び直せる（ボタンを足さずに、見出しに寄せる） */}
            {skills && skills.length > 1 ? (
              <button
                type="button"
                className="title-switch"
                aria-label={`${splitName(skill.name).main}：型を変える`}
                aria-haspopup="dialog"
                onClick={() => setPickingSkill(true)}
              >
                {splitName(skill.name).main}
                <ChevronDownIcon size={18} />
              </button>
            ) : (
              splitName(skill.name).main
            )}
          </h1>
        </div>
      </header>

      {confirmLeave && (
        <div className="confirm">
          <p>
            {editing
              ? '編集した内容が保存されていません。保存せずに戻りますか？'
              : items.length > 0
                ? `撮った動画・写真が ${items.length} 件あります。保存せずに戻ると消えます。`
                : '入力した内容が保存されていません。保存せずに戻ると消えます。'}
          </p>
          <div className="row">
            <button
              className="btn danger"
              onClick={() => {
                // 「保存せずに戻る」と選んだ書きかけは、次に開いたときに現れないよう消す
                if (!editing) clearDraft()
                if ('to' in confirmLeave) go(confirmLeave.to)
                else goBack(fallback)
              }}
            >
              {'to' in confirmLeave ? '保存せずに移動' : '保存せずに戻る'}
            </button>
            <button className="btn" onClick={() => setConfirmLeave(null)}>
              {editing ? '編集を続ける' : '記録を続ける'}
            </button>
          </div>
        </div>
      )}

      <section className="section">
        {items.length === 0 ? (
          // まだ撮っていない（カメラを閉じた・アプリのカメラが使えない）
          <>
            <div className="capture-buttons">
              <button type="button" className="btn capture" onClick={openCamera}>
                <VideoIcon size={28} />
                動画を撮る
              </button>
              <button type="button" className="btn capture" onClick={() => photoInput.current?.click()}>
                <CameraIcon size={28} />
                写真を撮る
              </button>
              <button type="button" className="btn capture" onClick={() => libraryInput.current?.click()}>
                <PhotoIcon size={28} />
                アルバム
              </button>
            </div>
            {next && !editing && (
              <p className="next-line">
                <span className="next-label">今回</span>
                <span className="next-text">{next.text}</span>
              </p>
            )}
          </>
        ) : (
          <ul className="previews">
            {items.map((item) => {
              const blob = itemBlob(item)
              const type = itemType(item)
              const poster = item.kind === 'new' ? item.poster?.blob : (item.replaced?.poster?.blob ?? item.media.poster)
              const privacyLabel = (item.kind === 'new' ? (item.privacy ?? videoSettings?.youtubePrivacy) : undefined) === 'public' ? '公開' : '限定公開'
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
                    item.kind === 'existing' && <NotOnDevice media={item.media} />
                  )}
                  <button type="button" className="remove" aria-label="外す" onClick={() => removeItem(item)}>
                    ×
                  </button>
                  <div className="preview-actions">
                    {blob && <span className="muted">{formatBytes(blob.size)}</span>}
                    {blob && isVideo({ type }) && (
                      <button type="button" className="btn small" onClick={() => setTrimming(item.key)}>
                        <ScissorsIcon size={16} />
                        編集
                      </button>
                    )}
                    {/* 保存先が YouTube のとき、この動画の公開範囲（押すたびに切り替わる）。上げたあとの動画は変えられない */}
                    {storage === 'youtube' && item.kind === 'new' && isVideo({ type }) && (
                      <button
                        type="button"
                        className="btn small"
                        aria-label={`YouTube の公開範囲：${privacyLabel}（押すと切り替わります）`}
                        onClick={() => togglePrivacy(item)}
                      >
                        {privacyLabel}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
            {/* 撮り足す（アプリのカメラ。アルバムもカメラの中から選べる） */}
            <li>
              <button type="button" className="media add-media" aria-label="撮り足す" onClick={openCamera}>
                <PlusIcon size={26} />
              </button>
            </li>
          </ul>
        )}
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
        {editing && storage === 'youtube' && items.some((i) => i.kind === 'existing' && i.replaced && i.media.youtubeId) && (
          <p className="muted small">
            切り取った動画は YouTube に上げ直します。前の動画は YouTube に残るので、不要なら YouTube アプリで削除してください。
          </p>
        )}
      </section>

      <section className="section reflect">
        <div className="segmented outcome-picker" role="radiogroup" aria-label="結果">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={outcome === o.value}
              className={outcome === o.value ? `selected outcome-${o.value}` : ''}
              onClick={() => {
                const nextOutcome = outcome === o.value ? undefined : o.value
                setOutcome(nextOutcome)
                // 原因は、うまくいかなかったときだけのもの。◎にしたら外す
                if (nextOutcome !== 'meh' && nextOutcome !== 'bad') setDraft((d) => ({ ...d, causes: undefined }))
                change()
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* うまくいかなかったときだけ、よくある原因をワンタップで選べる（書かなくて済むように） */}
        {causeOptions.length > 0 && (outcome === 'meh' || outcome === 'bad') && (
          <div className="cause-chips" role="group" aria-label="原因（あてはまるもの）">
            {causeOptions.map((c) => {
              const on = draft.causes?.includes(c) ?? false
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setDraft((d) => {
                      const prev = d.causes ?? []
                      return { ...d, causes: on ? prev.filter((x) => x !== c) : [...prev, c] }
                    })
                    change()
                  }}
                >
                  {c}
                </button>
              )
            })}
          </div>
        )}

        <div className="field">
          <label htmlFor="next-action">次の一手</label>
          {/* 押すだけで入る候補。前回と同じことを続けるときや、選んだ原因の直し方 */}
          {suggestions.length > 0 && (
            <div className="suggest-chips">
              {suggestions.map((sgt) => (
                <button
                  key={sgt.text}
                  type="button"
                  onClick={() => {
                    setDraft((d) => ({ ...d, nextAction: sgt.text }))
                    change()
                  }}
                >
                  <span className="suggest-prefix">{sgt.prefix}</span>
                  {sgt.text}
                </button>
              ))}
            </div>
          )}
          <textarea
            id="next-action"
            rows={2}
            value={draft.nextAction ?? ''}
            onChange={(e) => {
              setDraft((d) => ({ ...d, nextAction: e.target.value }))
              change()
            }}
            placeholder="次の杯で試すこと（次に記録するとき、カメラの上に出ます）"
          />
        </div>

        {showMemo ? (
          <label className="field">
            <span>メモ</span>
            <textarea
              rows={2}
              autoFocus={memoOpen && !draft.reason}
              value={draft.reason ?? ''}
              onChange={(e) => {
                setDraft((d) => ({ ...d, reason: e.target.value }))
                change()
              }}
              placeholder="気づいたこと・うまくいった理由など（キーボードのマイクで音声入力できます）"
            />
          </label>
        ) : (
          <button type="button" className="quiet-button memo-toggle" onClick={() => setMemoOpen(true)}>
            ＋ メモを足す
          </button>
        )}
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

      {recording && videoSettings && (
        <Recorder
          quality={videoSettings.quality}
          focus={editing ? undefined : next?.text}
          references={skill.references}
          onDone={(video, photo, quality) => {
            setRecording(false)
            // できあがりの写真も撮ったら、動画と一緒に記録に入れる（カップの絵には写真を使う）
            const files = [video, photo].filter((f): f is File => !!f)
            void addFiles(files, true, quality)
          }}
          onClose={() => {
            setRecording(false)
            // 何も撮らず、何も付けずに閉じたら、記録をやめて戻る（結果や次の一手を付けていたら、この画面に残る）
            const blank =
              items.length === 0 && !outcome && !draft.reason && !draft.nextAction && !(draft.causes?.length ?? 0)
            if (!editing && blank) goBack(fallback)
          }}
          onAlbum={() => {
            setRecording(false)
            libraryInput.current?.click()
          }}
          onFallback={(mode) => {
            setRecording(false)
            ;(mode === 'photo' ? photoInput : videoInput).current?.click()
          }}
        />
      )}

      {pickingSkill && skills && (
        <SkillPicker skills={skills} current={skillId} onPick={pickSkill} onClose={() => setPickingSkill(false)} />
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
        {editing ? (
          <button className="btn primary block" disabled={saving || !dirty} onClick={() => save()}>
            {saving ? '保存中…' : '保存する'}
          </button>
        ) : (
          // 続けて淹れるときは「もう1杯」（保存してすぐカメラへ）。終わるときは「保存」
          <div className="save-pair">
            <button className="btn" disabled={saving || nothingToSave} onClick={() => save(true)}>
              保存してもう1杯
            </button>
            <button className="btn primary" disabled={saving || nothingToSave} onClick={() => save()}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

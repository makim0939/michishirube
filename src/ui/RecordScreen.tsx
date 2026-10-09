import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db } from '../data/db'
import { addRecord, lastNextAction } from '../data/repo'
import type { Outcome } from '../domain/types'
import { Empty, formatAgo, MediaView, requestPersist } from './common'
import { useAction, useToast } from './feedback'
import { backHandler, goBack, href } from './router'

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: 'good', label: '◎ 成功' },
  { value: 'meh', label: '△ 惜しい' },
  { value: 'bad', label: '✕ 失敗' },
]

// 書きかけのメモは、カメラから戻ったときにページが再読み込みされても残るようにする
function useDraft(key: string) {
  const read = () => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? '{}') as { reason?: string; nextAction?: string }
    } catch {
      return {}
    }
  }
  const [draft, setDraft] = useState(read)
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(draft))
    } catch {
      // 保存できなくても入力は続けられる
    }
  }, [key, draft])
  const clear = () => {
    try {
      sessionStorage.removeItem(key)
    } catch {
      // 同上
    }
  }
  return [draft, setDraft, clear] as const
}

export function RecordScreen({ skillId }: { skillId: string }) {
  const run = useAction()
  const toast = useToast()
  const data = useLiveQuery(async () => {
    const skill = await db.skills.get(skillId)
    return { skill, next: skill ? await lastNextAction(skillId) : undefined }
  }, [skillId])

  const [files, setFiles] = useState<File[]>([])
  const [outcome, setOutcome] = useState<Outcome>()
  const [draft, setDraft, clearDraft] = useDraft(`michishirube:draft:${skillId}`)
  const [saving, setSaving] = useState(false)
  const videoInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)

  if (!data) return null
  const { skill, next } = data
  if (!skill) return <Empty>スキルが見つかりません。</Empty>

  const addFiles = (list: FileList | null) => {
    // FileList は input の value を空にすると中身も消えるので、先に配列へ写す
    const picked = list ? Array.from(list) : []
    if (picked.length > 0) setFiles((prev) => [...prev, ...picked])
  }

  const save = () =>
    run(async () => {
      setSaving(true)
      try {
        await addRecord({
          skillId,
          outcome,
          reason: draft.reason ?? '',
          nextAction: draft.nextAction ?? '',
          files,
        })
        clearDraft()
        void requestPersist()
        toast.show('記録しました')
        goBack('/')
      } finally {
        setSaving(false)
      }
    })

  return (
    <div className="screen record-screen">
      <header className="screen-header">
        <a className="back" href={href('/')} onClick={backHandler('/')} aria-label="戻る">
          ←
        </a>
        <h1>{skill.name}</h1>
      </header>

      <div className={`next-action big ${next ? '' : 'none'}`}>
        <span className="next-label">前回の次の一手{next && `（${formatAgo(next.at)}）`}</span>
        <span className="next-text">{next ? next.text : 'まだありません'}</span>
      </div>

      {skill.criteria && (
        <details className="criteria-details">
          <summary>達成条件</summary>
          <p>{skill.criteria}</p>
        </details>
      )}

      <section className="section">
        <div className="capture-buttons">
          <button type="button" className="btn capture" onClick={() => videoInput.current?.click()}>
            <span aria-hidden="true">🎥</span>動画を撮る
          </button>
          <button type="button" className="btn capture" onClick={() => photoInput.current?.click()}>
            <span aria-hidden="true">📷</span>写真を撮る
          </button>
          <button type="button" className="btn capture" onClick={() => libraryInput.current?.click()}>
            <span aria-hidden="true">🖼️</span>アルバム
          </button>
        </div>
        <input
          ref={videoInput}
          hidden
          type="file"
          accept="video/*"
          capture="environment"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={photoInput}
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={libraryInput}
          hidden
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {files.length > 0 && (
          <ul className="previews">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <MediaView blob={f} type={f.type} />
                <button
                  type="button"
                  className="remove"
                  aria-label="外す"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
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
              onClick={() => setOutcome(outcome === o.value ? undefined : o.value)}
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
            onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
            placeholder="例：ミルクが熱すぎて泡が粗くなった（キーボードのマイクで音声入力できます）"
          />
        </label>
        <label className="field">
          <span>次の一手</span>
          <textarea
            rows={2}
            value={draft.nextAction ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, nextAction: e.target.value }))}
            placeholder="例：60℃で止める。次回の記録画面の一番上に出ます"
          />
        </label>
      </section>

      <div className="sticky-actions">
        <button className="btn primary block" disabled={saving} onClick={save}>
          {saving ? '保存中…' : '保存する'}
        </button>
      </div>
    </div>
  )
}

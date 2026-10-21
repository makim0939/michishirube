import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import {
  buildVideoText,
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  getVideoTemplates,
  previewVars,
  resetVideoTemplates,
  setVideoTemplate,
  TEMPLATE_FIELDS,
  type VideoTemplates,
} from '../data/videoText'
import { ConfirmButton } from './common'
import { useAction } from './feedback'

type Kind = 'title' | 'description'

/**
 * YouTube に付けるタイトルと説明の書き方。
 * 入力するたびに保存する（保存ボタンは置かない）。項目は、押すと入力欄のカーソルの位置に入る。
 * 下のプレビューで、実際にどう付くかをその場で見られる
 */
export function YoutubeTextSettings() {
  const run = useAction()
  const saved = useLiveQuery(getVideoTemplates)
  const preview = useLiveQuery(previewVars)
  const [draft, setDraft] = useState<VideoTemplates>()
  const last = useRef<Kind>('title')
  const fields = useRef<Record<Kind, HTMLInputElement | HTMLTextAreaElement | null>>({ title: null, description: null })
  // 入力中の文字は、保存の反映を待たずに画面で持つ（保存の読み直しで、カーソルが飛ばないように）
  useEffect(() => {
    if (saved && !draft) setDraft(saved)
  }, [saved, draft])
  if (!draft || !preview) return null

  const edit = (kind: Kind, value: string) => {
    setDraft({ ...draft, [kind]: value })
    void setVideoTemplate(kind, value)
  }

  const insert = (name: string) => {
    const kind = last.current
    const el = fields.current[kind]
    const text = `{${name}}`
    const value = draft[kind]
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    edit(kind, value.slice(0, start) + text + value.slice(end))
    // 入れたあとも、続けて打てるように、入れた文字の後ろにカーソルを置く
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + text.length, start + text.length)
    })
  }

  const shown = buildVideoText(draft, preview.vars)
  const changed = draft.title !== DEFAULT_TITLE || draft.description !== DEFAULT_DESCRIPTION

  return (
    <>
      <section className="section">
        <div className="stack yt-fields">
          <label className="field">
            <span>タイトル</span>
            <input
              ref={(el) => {
                fields.current.title = el
              }}
              value={draft.title}
              placeholder={DEFAULT_TITLE}
              onFocus={() => (last.current = 'title')}
              onChange={(e) => edit('title', e.target.value)}
            />
          </label>
          <label className="field">
            <span>説明</span>
            <textarea
              ref={(el) => {
                fields.current.description = el
              }}
              rows={8}
              value={draft.description}
              onFocus={() => (last.current = 'description')}
              onChange={(e) => edit('description', e.target.value)}
            />
          </label>
          <div className="suggest-chips" aria-label="入れられる項目（押すと、カーソルの位置に入ります）">
            {TEMPLATE_FIELDS.map((name) => (
              <button key={name} type="button" onClick={() => insert(name)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <h2>プレビュー</h2>
        <div className="yt-preview">
          <strong>{shown.title}</strong>
          {shown.description && <p>{shown.description}</p>}
        </div>
        <p className="muted small">
          {preview.sample ? '見本です。' : 'いちばん新しい記録の場合です。'}
          上げ済みの動画は変わりません。
        </p>
      </section>

      {changed && (
        <ConfirmButton
          className="btn small ghost"
          confirmLabel="もどす"
          message="タイトルと説明を、標準の書き方にもどします。"
          onConfirm={() =>
            run(async () => {
              await resetVideoTemplates()
              setDraft({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION })
            })
          }
        >
          標準にもどす
        </ConfirmButton>
      )}
    </>
  )
}

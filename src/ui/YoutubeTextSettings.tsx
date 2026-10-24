import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import {
  buildVideoText,
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  getVideoTemplates,
  isCustomTemplates,
  previewVars,
  resetVideoTemplates,
  setVideoTemplate,
  TEMPLATE_FIELD_LABEL,
  TEMPLATE_FIELDS,
  type VideoTemplates,
} from '../data/videoText'
import { ConfirmButton } from './common'
import { useAction } from './feedback'
import { t } from '../i18n'

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
  // 保存は1つずつ順番に流す（続けて打っても、最後に打った内容が残るように）
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const fields = useRef<Record<Kind, HTMLInputElement | HTMLTextAreaElement | null>>({ title: null, description: null })
  // 入力中の文字は、保存の反映を待たずに画面で持つ（保存の読み直しで、カーソルが飛ばないように）
  useEffect(() => {
    if (saved && !draft) setDraft(saved)
  }, [saved, draft])
  if (!draft || !preview) return null

  const edit = (kind: Kind, value: string) => {
    setDraft({ ...draft, [kind]: value })
    saving.current = saving.current.then(() => setVideoTemplate(kind, value)).catch(() => {})
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
  const changed = isCustomTemplates(draft)

  return (
    <>
      <section className="section">
        <div className="stack yt-fields">
          <label className="field">
            <span>{t.videoText.title}</span>
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
            <span>{t.videoText.description}</span>
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
          <div className="suggest-chips" role="group" aria-label={t.videoText.fieldsLabel}>
            {TEMPLATE_FIELDS.map((name) => (
              <button key={name} type="button" onClick={() => insert(TEMPLATE_FIELD_LABEL[name])}>
                {TEMPLATE_FIELD_LABEL[name]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <h2>{t.videoText.preview}</h2>
        <div className="yt-preview">
          <strong>{shown.title}</strong>
          {shown.description && <p>{shown.description}</p>}
        </div>
        <p className="muted small">
          {preview.sample ? t.videoText.sample : t.videoText.latest}
          {t.videoText.uploadedUnchanged}
        </p>
      </section>

      {changed && (
        <ConfirmButton
          className="btn small ghost"
          confirmLabel={t.videoText.resetConfirm}
          message={t.videoText.resetMessage}
          onConfirm={() =>
            run(async () => {
              await resetVideoTemplates()
              setDraft({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION })
            })
          }
        >
          {t.videoText.reset}
        </ConfirmButton>
      )}
    </>
  )
}

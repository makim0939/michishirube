import { useState } from 'react'
import { addReference, removeReference } from '../data/repo'
import { isWebUrl } from '../domain/template'
import type { Skill } from '../domain/types'
import { ConfirmButton } from './common'
import { useAction, useToast } from './feedback'
import { t } from '../i18n'

function AddReferenceForm({ skillId, onDone }: { skillId: string; onDone: () => void }) {
  const run = useAction()
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  return (
    <form
      className="confirm"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await run(async () => {
          await addReference(skillId, { url, title, note })
          return true
        })
        if (ok) {
          toast.show(t.refs.added)
          onDone()
        }
      }}
    >
      <label className="field">
        <span>URL</span>
        <input
          autoFocus
          type="url"
          inputMode="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t.refs.urlPlaceholder}
        />
      </label>
      <label className="field">
        <span>{t.refs.title}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.refs.titlePlaceholder} />
      </label>
      <label className="field">
        <span>{t.refs.note}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.refs.notePlaceholder} />
      </label>
      <div className="row">
        <button className="btn primary" type="submit">
          {t.refs.add}
        </button>
        <button className="btn" type="button" onClick={onDone}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  )
}

/** 型の画面の「手本の動画・記事」（参考資料）：一覧・追加・削除 */
export function References({ skill }: { skill: Skill }) {
  const run = useAction()
  const [adding, setAdding] = useState(false)
  return (
    <section className="section">
      <div className="section-head">
        <h2>{t.refs.heading}</h2>
        {!adding && (
          <button className="btn small" onClick={() => setAdding(true)}>
            {t.refs.addShort}
          </button>
        )}
      </div>
      {adding && <AddReferenceForm skillId={skill.id} onDone={() => setAdding(false)} />}
      {/* 空のときは見出しと「＋ 追加」だけ（使い道は、追加したあとカメラの「手本」で分かる） */}
      {skill.references.length === 0 ? null : (
        <ul className="references editable">
          {skill.references.map((r) => (
            <li key={r.id}>
              <div className="reference-main">
                {isWebUrl(r.url) ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    {r.title}
                  </a>
                ) : (
                  <span>{r.title}</span>
                )}
                {r.note && <span className="reference-note">{r.note}</span>}
              </div>
              <ConfirmButton
                className="btn small ghost"
                confirmLabel={t.refs.remove}
                onConfirm={() => run(() => removeReference(skill.id, r.id))}
              >
                ×
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

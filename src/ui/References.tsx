import { useState } from 'react'
import { addReference, removeReference } from '../data/repo'
import { isWebUrl } from '../domain/template'
import type { Skill } from '../domain/types'
import { ConfirmButton } from './common'
import { useAction, useToast } from './feedback'

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
          toast.show('手本を追加しました')
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
          placeholder="https://youtu.be/…（共有ボタンでコピーして貼り付け）"
        />
      </label>
      <label className="field">
        <span>タイトル（任意）</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="空ならサイト名になります" />
      </label>
      <label className="field">
        <span>見るところのメモ（任意）</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：2:30〜 注ぎ始めの高さ" />
      </label>
      <div className="row">
        <button className="btn primary" type="submit">
          追加する
        </button>
        <button className="btn" type="button" onClick={onDone}>
          やめる
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
        <h2>手本の動画・記事</h2>
        {!adding && (
          <button className="btn small" onClick={() => setAdding(true)}>
            ＋ 追加
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
                confirmLabel="削除"
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

import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../data/db'
import { createSkill, deleteSkill, updateSkill, type SkillInput } from '../data/repo'
import { descendants, sortByDepth } from '../domain/logic'
import type { Skill } from '../domain/types'
import { ConfirmButton, Empty } from './common'
import { useAction, useToast } from './feedback'
import { backHandler, goBack, href, replace } from './router'
import { BackIcon } from './icons'

function SkillForm({
  initial,
  candidates,
  onSubmit,
  cancelPath,
  noCandidatesText = 'この分野にほかの型はありません。',
  extra,
}: {
  initial: SkillInput
  candidates: Skill[]
  onSubmit: (input: SkillInput) => Promise<void>
  cancelPath: string
  /** 前提にできる型が1つも無いときの一言（理由が、ほかの型が無いのか、すべてあとの型なのかで違う） */
  noCandidatesText?: string
  extra?: React.ReactNode
}) {
  const [form, setForm] = useState<SkillInput>(initial)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof SkillInput>(key: K, value: SkillInput[K]) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await onSubmit(form)
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="field">
        <span>名前</span>
        <input value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="例：ハート" />
      </label>
      <label className="field">
        <span>説明・やり方</span>
        <textarea rows={5} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </label>

      <fieldset className="field">
        <legend>前提（この型の前に身につけておくとよい型）</legend>
        {candidates.length === 0 ? (
          <p className="muted">{noCandidatesText}</p>
        ) : (
          <ul className="checks">
            {candidates.map((c) => (
              <li key={c.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={form.prereqIds.includes(c.id)}
                    onChange={(e) =>
                      set(
                        'prereqIds',
                        e.target.checked ? [...form.prereqIds, c.id] : form.prereqIds.filter((p) => p !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              </li>
            ))}
          </ul>
        )}
        {candidates.length > 1 && <small className="muted">複数選んだときは、どれか1つでよい</small>}
      </fieldset>

      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>
          保存する
        </button>
        <a className="btn" href={href(cancelPath)} onClick={backHandler(cancelPath)}>
          やめる
        </a>
      </div>
      {extra}
    </form>
  )
}

export function EditSkillScreen({ id }: { id: string }) {
  const run = useAction()
  const toast = useToast()
  const data = useLiveQuery(async () => {
    const skill = await db.skills.get(id)
    if (!skill) return { skill: undefined, skills: [] }
    return { skill, skills: await db.skills.where('domainId').equals(skill.domainId).toArray() }
  }, [id])

  if (!data) return null
  const { skill, skills } = data
  if (!skill) return <Empty>型が見つかりません。</Empty>
  // 自分より後ろのスキルを前提にすると循環するので、候補から外す
  const after = descendants(skill.id, skills)
  const candidates = sortByDepth(skills.filter((s) => s.id !== skill.id && !after.has(s.id)))

  return (
    <div className="screen">
      <header className="screen-header">
        <a className="back" href={href(`/skill/${id}`)} onClick={backHandler(`/skill/${id}`)} aria-label="戻る">
          <BackIcon size={26} />
        </a>
        <h1>型を編集</h1>
      </header>
      <SkillForm
        key={skill.id}
        initial={{
          name: skill.name,
          description: skill.description,
          prereqIds: skill.prereqIds,
        }}
        candidates={candidates}
        // ほかの型があるのに候補が空なのは、ほかの型がすべて、この型のあとに続くものだから（前提にすると循環する）
        noCandidatesText={skills.length > 1 ? 'ほかの型は、すべてこの型のあとにやる型です。' : undefined}
        cancelPath={`/skill/${id}`}
        onSubmit={async (input) => {
          const ok = await run(async () => {
            await updateSkill(id, input)
            return true
          })
          if (ok) {
            toast.show('保存しました')
            goBack(`/skill/${id}`)
          }
        }}
        extra={
          <div className="danger-zone">
            <ConfirmButton
              className="btn ghost"
              confirmLabel="削除する"
              message="この型と、その記録・動画・写真をすべて削除します。元に戻せません。"
              onConfirm={async () => {
                const ok = await run(async () => {
                  await deleteSkill(id)
                  return true
                })
                if (ok) replace(`/map/${skill.domainId}`)
              }}
            >
              この型を削除
            </ConfirmButton>
          </div>
        }
      />
    </div>
  )
}

export function NewSkillScreen({ domainId }: { domainId: string }) {
  const run = useAction()
  const data = useLiveQuery(async () => {
    const domain = await db.domains.get(domainId)
    return { domain, skills: await db.skills.where('domainId').equals(domainId).toArray() }
  }, [domainId])

  if (!data) return null
  if (!data.domain) return <Empty>分野が見つかりません。</Empty>

  return (
    <div className="screen">
      <header className="screen-header">
        <a className="back" href={href(`/map/${domainId}`)} onClick={backHandler(`/map/${domainId}`)} aria-label="戻る">
          <BackIcon size={26} />
        </a>
        <h1>{data.domain.name} に型を追加</h1>
      </header>
      <SkillForm
        initial={{ name: '', description: '', prereqIds: [] }}
        candidates={sortByDepth(data.skills)}
        cancelPath={`/map/${domainId}`}
        onSubmit={async (input) => {
          const id = await run(() => createSkill(domainId, input))
          if (id) replace(`/skill/${id}`)
        }}
      />
    </div>
  )
}

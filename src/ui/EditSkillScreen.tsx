import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../data/db'
import { createSkill, deleteSkill, updateSkill, type SkillInput } from '../data/repo'
import { descendants, sortByDepth } from '../domain/logic'
import type { Skill } from '../domain/types'
import { ConfirmButton, Empty } from './common'
import { useAction, useToast } from './feedback'
import { go, href } from './router'

function SkillForm({
  initial,
  candidates,
  onSubmit,
  cancelHref,
  extra,
}: {
  initial: SkillInput
  candidates: Skill[]
  onSubmit: (input: SkillInput) => Promise<void>
  cancelHref: string
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
        <span>達成条件</span>
        <textarea
          rows={2}
          value={form.criteria}
          onChange={(e) => set('criteria', e.target.value)}
          placeholder="例：中央に左右対称のハートが10回中8回描ける"
        />
        <small className="muted">「できた気がする」ではなく、回数や状態で判定できる書き方にすると、達成の判断がぶれません。</small>
      </label>
      <label className="field">
        <span>説明・やり方</span>
        <textarea rows={5} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </label>

      <fieldset className="field">
        <legend>出典</legend>
        {form.sources.map((s, i) => (
          <div key={i} className="source-row">
            <input
              value={s.title}
              placeholder="タイトル（教本名、講座名など）"
              onChange={(e) => set('sources', form.sources.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
            />
            <input
              value={s.url ?? ''}
              type="url"
              placeholder="URL（任意）"
              onChange={(e) => set('sources', form.sources.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
            />
            <button
              type="button"
              className="btn small ghost"
              onClick={() => set('sources', form.sources.filter((_, j) => j !== i))}
            >
              外す
            </button>
          </div>
        ))}
        <button type="button" className="btn small" onClick={() => set('sources', [...form.sources, { title: '', url: '' }])}>
          ＋ 出典を追加
        </button>
      </fieldset>

      <fieldset className="field">
        <legend>前提（先に達成しておくスキル）</legend>
        {candidates.length === 0 ? (
          <p className="muted">この分野にほかのスキルはありません。</p>
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
      </fieldset>

      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>
          保存する
        </button>
        <a className="btn" href={cancelHref}>
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
  if (!skill) return <Empty>スキルが見つかりません。</Empty>
  // 自分より後ろのスキルを前提にすると循環するので、候補から外す
  const after = descendants(skill.id, skills)
  const candidates = sortByDepth(skills.filter((s) => s.id !== skill.id && !after.has(s.id)))

  return (
    <div className="screen">
      <header className="screen-header">
        <a className="back" href={href(`/skill/${id}`)} aria-label="戻る">
          ←
        </a>
        <h1>スキルを編集</h1>
      </header>
      <SkillForm
        key={skill.id}
        initial={{
          name: skill.name,
          description: skill.description,
          criteria: skill.criteria,
          sources: skill.sources,
          prereqIds: skill.prereqIds,
        }}
        candidates={candidates}
        cancelHref={href(`/skill/${id}`)}
        onSubmit={async (input) => {
          const ok = await run(async () => {
            await updateSkill(id, input)
            return true
          })
          if (ok) {
            toast.show('保存しました')
            go(`/skill/${id}`)
          }
        }}
        extra={
          <div className="danger-zone">
            <ConfirmButton
              className="btn ghost"
              confirmLabel="削除する"
              message="このスキルと、その記録・動画・写真をすべて削除します。元に戻せません。"
              onConfirm={async () => {
                const ok = await run(async () => {
                  await deleteSkill(id)
                  return true
                })
                if (ok) go(`/map/${skill.domainId}`)
              }}
            >
              このスキルを削除
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
        <a className="back" href={href(`/map/${domainId}`)} aria-label="戻る">
          ←
        </a>
        <h1>{data.domain.name} にスキルを追加</h1>
      </header>
      <SkillForm
        initial={{ name: '', description: '', criteria: '', sources: [], prereqIds: [] }}
        candidates={sortByDepth(data.skills)}
        cancelHref={href(`/map/${domainId}`)}
        onSubmit={async (input) => {
          const id = await run(() => createSkill(domainId, input))
          if (id) go(`/skill/${id}`)
        }}
      />
    </div>
  )
}

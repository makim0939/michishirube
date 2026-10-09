import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useRef, useState } from 'react'
import { db } from '../data/db'
import { createDomain, deleteDomain, importTemplate, renameDomain } from '../data/repo'
import { computeStates, sortByDepth } from '../domain/logic'
import { entitiesToTemplate } from '../domain/template'
import { ConfirmButton, saveFile, StateBadge } from './common'
import { useAction, useToast } from './feedback'
import { go, href } from './router'

// React Flow は大きいので、ロードマップを開いたときだけ読み込む
const RoadmapGraph = lazy(() => import('./RoadmapGraph').then((m) => ({ default: m.RoadmapGraph })))

function NewDomainForm({ onDone }: { onDone: () => void }) {
  const run = useAction()
  const [name, setName] = useState('')
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const id = await run(() => createDomain(name))
        if (id) {
          onDone()
          go(`/map/${id}`)
        }
      }}
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="分野の名前（例：ピアノ）" />
      <button className="btn small primary" type="submit">
        作る
      </button>
      <button className="btn small" type="button" onClick={onDone}>
        やめる
      </button>
    </form>
  )
}

export function MapScreen({ domainId }: { domainId?: string }) {
  const run = useAction()
  const toast = useToast()
  const importInput = useRef<HTMLInputElement>(null)
  const [addingDomain, setAddingDomain] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const domains = await db.domains.orderBy('order').toArray()
    const current = domains.find((d) => d.id === domainId) ?? domains[0]
    const skills = current ? await db.skills.where('domainId').equals(current.id).toArray() : []
    return { domains, current, skills }
  }, [domainId])

  if (!data) return null
  const { domains, current, skills } = data
  const states = computeStates(skills)
  const doneCount = skills.filter((s) => s.status === 'done').length

  const onImport = async (file: File | undefined) => {
    if (!file) return
    const id = await run(async () => {
      let json: unknown
      try {
        json = JSON.parse(await file.text())
      } catch {
        throw new Error('JSON として読み込めませんでした')
      }
      return importTemplate(json)
    })
    if (id) {
      toast.show('ロードマップを読み込みました')
      go(`/map/${id}`)
    }
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>ロードマップ</h1>
      </header>

      <div className="domain-tabs" role="tablist">
        {domains.map((d) => (
          <a
            key={d.id}
            role="tab"
            aria-selected={d.id === current?.id}
            className={d.id === current?.id ? 'selected' : ''}
            href={href(`/map/${d.id}`)}
          >
            {d.name}
          </a>
        ))}
        {!addingDomain && (
          <button className="add" onClick={() => setAddingDomain(true)}>
            ＋ 分野
          </button>
        )}
      </div>
      {addingDomain && <NewDomainForm onDone={() => setAddingDomain(false)} />}

      {current ? (
        <>
          <div className="row wrap between">
            {renaming !== null ? (
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault()
                  await run(() => renameDomain(current.id, renaming))
                  setRenaming(null)
                }}
              >
                <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} />
                <button className="btn small primary" type="submit">
                  保存
                </button>
              </form>
            ) : (
              <p className="muted">
                {skills.length} スキル中 {doneCount} 達成
              </p>
            )}
            <a className="btn small primary" href={href(`/domain/${current.id}/new-skill`)}>
              ＋ スキル
            </a>
          </div>

          {skills.length > 0 ? (
            <>
              <Suspense fallback={<div className="graph" />}>
                <RoadmapGraph skills={skills} />
              </Suspense>
              <ul className="legend" aria-label="凡例">
                <li><StateBadge state="done" /></li>
                <li><StateBadge state="active" /></li>
                <li><StateBadge state="available" /></li>
                <li><StateBadge state="locked" /></li>
              </ul>
              <ul className="list">
                {sortByDepth(skills).map((s) => (
                  <li key={s.id} className="list-row">
                    <a href={href(`/skill/${s.id}`)} className="list-main">
                      <span>{s.name}</span>
                      {s.criteria && <span className="list-sub">{s.criteria}</span>}
                    </a>
                    <StateBadge state={states.get(s.id)!} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="empty">
              <p>まだスキルがありません。「＋ スキル」から追加するか、ロードマップの JSON を読み込んでください。</p>
            </div>
          )}

          <details className="section manage">
            <summary>この分野の管理</summary>
            <div className="stack">
              <button className="btn" onClick={() => setRenaming(current.name)}>
                名前を変える
              </button>
              <button
                className="btn"
                onClick={() =>
                  run(async () => {
                    const json = JSON.stringify(entitiesToTemplate(current, sortByDepth(skills)), null, 2)
                    await saveFile(new Blob([json], { type: 'application/json' }), `roadmap-${current.name}.json`)
                  })
                }
              >
                ロードマップを JSON で書き出す
              </button>
              <ConfirmButton
                className="btn ghost"
                confirmLabel="削除する"
                message={`「${current.name}」のスキルと、記録・動画・写真をすべて削除します。元に戻せません。`}
                onConfirm={async () => {
                  await run(() => deleteDomain(current.id))
                  go('/map')
                }}
              >
                この分野を削除
              </ConfirmButton>
            </div>
          </details>
        </>
      ) : (
        <div className="empty">
          <p>分野がありません。「＋ 分野」から作るか、ロードマップの JSON を読み込んでください。</p>
        </div>
      )}

      <section className="section">
        <button className="btn" onClick={() => importInput.current?.click()}>
          ロードマップの JSON を読み込む
        </button>
        <input
          ref={importInput}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            void onImport(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <p className="muted small">新しい分野として追加されます。形式は README を参照してください。</p>
      </section>
    </div>
  )
}

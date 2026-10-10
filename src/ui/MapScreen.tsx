import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db } from '../data/db'
import { activateSkill, createDomain, deleteDomain, getSettings, importTemplate, renameDomain } from '../data/repo'
import { canActivate, computeStates, indexById, prereqsDone, sortByDepth } from '../domain/logic'
import { entitiesToTemplate } from '../domain/template'
import type { Skill } from '../domain/types'
import { ConfirmButton, saveFile, splitName } from './common'
import { useAction, useToast } from './feedback'
import { PlusIcon } from './icons'
import { go, href } from './router'
import { readStorage, writeStorage } from './storage'
import { patternFor, patternUrl } from './world'

const LAST_DOMAIN_KEY = 'michishirube:last-domain'

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

/** 型の見本の絵。見本の無い型（自分で作った分野など）は、クレマの丸 */
export function PatternImage({ name, className, dim }: { name: string; className?: string; dim?: boolean }) {
  const p = patternFor(name)
  const cls = `pattern-image ${className ?? ''} ${dim ? 'dim' : ''}`
  return p ? <img className={cls} src={patternUrl(p)} alt="" /> : <span className={`${cls} none`} aria-hidden="true" />
}

function names(list: Skill[]) {
  return list.map((s) => `「${splitName(s.name).main}」`).join('')
}

export function MapScreen({ domainId }: { domainId?: string }) {
  const run = useAction()
  const toast = useToast()
  const importInput = useRef<HTMLInputElement>(null)
  const [addingDomain, setAddingDomain] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const [domains, settings, allSkills] = await Promise.all([
      db.domains.orderBy('order').toArray(),
      getSettings(),
      db.skills.toArray(),
    ])
    // タブから開いたときは、最後に見ていた分野を出す
    const wanted = domainId ?? readStorage('local', LAST_DOMAIN_KEY)
    const current = domains.find((d) => d.id === wanted) ?? domains[0]
    const skills = current ? allSkills.filter((s) => s.domainId === current.id) : []
    // 練習中の型だけ、杯数と◎の数を出す
    const stats = new Map<string, { count: number; good: number }>()
    for (const s of skills.filter((s) => s.status === 'active')) {
      const records = await db.records.where('skillId').equals(s.id).toArray()
      stats.set(s.id, { count: records.length, good: records.filter((r) => r.outcome === 'good').length })
    }
    return { domains, current, skills, settings, allSkills, stats }
  }, [domainId])

  const currentId = data?.current?.id
  useEffect(() => {
    if (currentId) writeStorage('local', LAST_DOMAIN_KEY, currentId)
  }, [currentId])

  if (!data) return null
  const { domains, current, skills, settings, allSkills, stats } = data
  const states = computeStates(skills)
  const byId = indexById(skills)
  const ordered = sortByDepth(skills)
  const active = ordered.filter((s) => states.get(s.id) === 'active')
  const available = ordered.filter((s) => states.get(s.id) === 'available')
  const locked = ordered.filter((s) => states.get(s.id) === 'locked')
  const done = ordered.filter((s) => states.get(s.id) === 'done')

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

  const prereqsOf = (s: Skill) => s.prereqIds.map((id) => byId.get(id)).filter((p): p is Skill => !!p)

  return (
    <div className="screen types">
      <header className="screen-header">
        <h1>型</h1>
        {skills.length > 0 && (
          <span className="muted small">
            {skills.length}つのうち {done.length}つ できた
          </span>
        )}
      </header>

      {domains.length > 1 && (
        <div className="domain-tabs" role="tablist" aria-label="分野">
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
        </div>
      )}

      {current && skills.length === 0 && (
        <div className="empty">
          <p>まだ型がありません。下の「型を追加」から作るか、ロードマップの JSON を読み込んでください。</p>
        </div>
      )}
      {!current && (
        <div className="empty">
          <p>分野がありません。下の「分野を追加」から作るか、ロードマップの JSON を読み込んでください。</p>
        </div>
      )}

      {active.length > 0 && (
        <section className="section">
          <h2>練習中</h2>
          <ul className="type-cards">
            {active.map((s) => {
              const st = stats.get(s.id)
              return (
                <li key={s.id}>
                  <a className="type-card" href={href(`/skill/${s.id}`)}>
                    <PatternImage name={s.name} className="large" />
                    <span className="type-card-body">
                      <span className="type-name">{splitName(s.name).main}</span>
                      <span className="muted small">
                        {st ? `${st.count}杯 · うち ◎ ${st.good}杯` : '0杯'}
                      </span>
                      <span className="type-card-link">記録と合格の目安を見る</span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {available.length > 0 && (
        <section className="section">
          <h2>次に挑戦できる</h2>
          <ul className="type-rows">
            {available.map((s) => {
              const check = canActivate(s, allSkills, settings.maxActive)
              const prereqs = prereqsOf(s)
              const parallel = !prereqsDone(s, byId)
              return (
                <li key={s.id} className="type-row">
                  <a href={href(`/skill/${s.id}`)} className="type-row-main">
                    <PatternImage name={s.name} />
                    <span className="type-row-text">
                      <span className="type-name">{splitName(s.name).main}</span>
                      <span className="muted small">
                        {parallel
                          ? '前提と並行して練習できる'
                          : prereqs.length > 0
                            ? `${names(prereqs)}のつぎ`
                            : '最初の型'}
                      </span>
                    </span>
                  </a>
                  <button
                    className="btn small"
                    disabled={!check.ok}
                    onClick={() =>
                      run(async () => {
                        await activateSkill(s.id)
                        toast.show(`「${splitName(s.name).main}」の練習を始めます`)
                      })
                    }
                  >
                    はじめる
                  </button>
                </li>
              )
            })}
          </ul>
          {available.some((s) => !canActivate(s, allSkills, settings.maxActive).ok) && (
            <p className="muted small">
              練習中は {settings.maxActive} つまでです。どれかを「できた」にするか、練習をやめると始められます。
            </p>
          )}
        </section>
      )}

      {locked.length > 0 && (
        <section className="section">
          <h2>その先</h2>
          <ul className="type-rows">
            {locked.map((s) => {
              const pending = prereqsOf(s).filter((p) => p.status !== 'done')
              return (
                <li key={s.id} className="type-row">
                  <a href={href(`/skill/${s.id}`)} className="type-row-main">
                    <PatternImage name={s.name} dim />
                    <span className="type-row-text">
                      <span className="type-name muted">{splitName(s.name).main}</span>
                      <span className="muted small">{pending.length > 0 ? `${names(pending)}ができたら` : ''}</span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section className="section done-section">
          <h2>できた</h2>
          <ul className="done-grid">
            {done.map((s) => (
              <li key={s.id}>
                <a href={href(`/skill/${s.id}`)}>
                  <PatternImage name={s.name} className="small" />
                  <span>{splitName(s.name).main}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="section manage">
        <summary>型と分野の管理</summary>
        <div className="stack">
          {current && (
            <a className="btn" href={href(`/domain/${current.id}/new-skill`)}>
              <PlusIcon size={18} />
              {current.name} に型を追加
            </a>
          )}
          {addingDomain ? (
            <NewDomainForm onDone={() => setAddingDomain(false)} />
          ) : (
            <button className="btn" onClick={() => setAddingDomain(true)}>
              <PlusIcon size={18} />
              分野を追加（ピアノなど）
            </button>
          )}
          {current &&
            (renaming !== null ? (
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const ok = await run(async () => {
                    await renameDomain(current.id, renaming)
                    return true
                  })
                  // 失敗したときは入力を残して、その場で直せるようにする
                  if (ok) setRenaming(null)
                }}
              >
                <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} />
                <button className="btn small primary" type="submit">
                  保存
                </button>
              </form>
            ) : (
              <button className="btn" onClick={() => setRenaming(current.name)}>
                「{current.name}」の名前を変える
              </button>
            ))}
          {current && (
            <button
              className="btn"
              onClick={() =>
                run(async () => {
                  const json = JSON.stringify(entitiesToTemplate(current, ordered), null, 2)
                  await saveFile(new Blob([json], { type: 'application/json' }), `roadmap-${current.name}.json`)
                })
              }
            >
              ロードマップを JSON で書き出す
            </button>
          )}
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
          <p className="muted small">読み込んだロードマップは新しい分野として追加されます。形式は README を参照してください。</p>
          {current && (
            <ConfirmButton
              className="btn ghost"
              confirmLabel="削除する"
              message={`「${current.name}」の型と、記録・動画・写真をすべて削除します。元に戻せません。`}
              onConfirm={async () => {
                const ok = await run(async () => {
                  await deleteDomain(current.id)
                  return true
                })
                if (ok) go('/map')
              }}
            >
              「{current.name}」を削除
            </ConfirmButton>
          )}
        </div>
      </details>
    </div>
  )
}

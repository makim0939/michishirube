import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { db } from '../data/db'
import { activateSkill, createDomain, deleteDomain, getSettings, importTemplate, renameDomain } from '../data/repo'
import { canActivate, computeStates, indexById, practiceOrder, prereqsDone, sortByDepth } from '../domain/logic'
import { entitiesToTemplate } from '../domain/template'
import type { Skill } from '../domain/types'
import { ConfirmButton, saveFile, splitName } from './common'
import { useAction, useToast } from './feedback'
import { PlusIcon } from './icons'
import { PatternImage } from './PatternImage'
import { go, href } from './router'
import { readStorage, writeStorage } from './storage'

const LAST_DOMAIN_KEY = 'michishirube:last-domain'
const VIEW_KEY = 'michishirube:types-view'

// 図の部品（React Flow）は大きいので、ロードマップを開いたときに読み込む（今日の画面の表示を遅くしない）
const RoadmapGraph = lazy(() => import('./RoadmapGraph').then((m) => ({ default: m.RoadmapGraph })))

type View = 'roadmap' | 'list'

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

function LimitNote({ max }: { max: number }) {
  return (
    <p className="muted small">練習中は {max} つまでです。どれかを「できた」にするか、練習を中断すると始められます。</p>
  )
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
  // 初めは一覧（すぐ始められる）。つながりの図（ロードマップ）に切り替えたら、そちらを覚えておく
  const [view, setView] = useState<View>(() => (readStorage('local', VIEW_KEY) === 'roadmap' ? 'roadmap' : 'list'))
  const changeView = (v: View) => {
    setView(v)
    writeStorage('local', VIEW_KEY, v)
  }

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
    // 練習中の型だけ、杯数と◎の数、最後に練習した日時（並びに使う）を出す
    const stats = new Map<string, { count: number; good: number; last: number }>()
    for (const s of skills.filter((s) => s.status === 'active')) {
      const records = await db.records.where('skillId').equals(s.id).toArray()
      // 今日の画面と同じく、最後の記録の日時（記録が無ければ練習を始めた日時）
      const last = records.length > 0 ? Math.max(...records.map((r) => r.createdAt)) : (s.activatedAt ?? 0)
      stats.set(s.id, { count: records.length, good: records.filter((r) => r.outcome === 'good').length, last })
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
  // 練習中は、今日の画面と同じ並び（並べ替えた順・最近練習した順）
  const active = practiceOrder(
    ordered.filter((s) => states.get(s.id) === 'active'),
    settings.focusOrder,
    (s) => s.id,
    (s) => stats.get(s.id)?.last ?? 0,
  )
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
  // 練習中の上限は全分野の合計で数える
  const atLimit = allSkills.filter((s) => s.status === 'active').length >= settings.maxActive

  const startButton = (skill: Skill, disabled: boolean) => (
    <button
      className="btn small"
      disabled={disabled}
      onClick={() =>
        run(async () => {
          await activateSkill(skill.id)
          toast.show(`「${splitName(skill.name).main}」の練習を始めます`)
        })
      }
    >
      はじめる
    </button>
  )

  return (
    <div className="screen types">
      <header className="screen-header">
        <h1>型</h1>
        {skills.length > 0 && (
          <span className="muted small">
            できた {done.length} / {skills.length}
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

      {skills.length > 0 && (
        <div className="segmented small view-switch" role="group" aria-label="表示">
          <button
            type="button"
            className={view === 'list' ? 'selected' : ''}
            aria-pressed={view === 'list'}
            onClick={() => changeView('list')}
          >
            一覧
          </button>
          <button
            type="button"
            className={view === 'roadmap' ? 'selected' : ''}
            aria-pressed={view === 'roadmap'}
            onClick={() => changeView('roadmap')}
          >
            ロードマップ
          </button>
        </div>
      )}

      {view === 'roadmap' && current && skills.length > 0 && (
        <>
          <Suspense fallback={<div className="graph" aria-busy="true" />}>
            <RoadmapGraph key={current.id} skills={skills} />
          </Suspense>
          <p className="muted small">型を押すと、合格の目安と記録が見られます。指で動かしたり、広げたりできます。</p>
        </>
      )}

      {current && skills.length === 0 && (
        <div className="empty">
          <p>まだ型がありません。下の「型と分野の管理」から追加するか、設定の「用意されているロードマップ」から入れてください。</p>
        </div>
      )}
      {!current && (
        <div className="empty">
          <p>分野がありません。設定の「用意されているロードマップ」から入れるか、下の「型と分野の管理」から作ってください。</p>
        </div>
      )}

      {view === 'list' && active.length > 0 && (
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

      {/* 次に始められる型は、どちらの表示でもすぐ始められるように出す */}
      {available.length > 0 && (
        <section className="section">
          <h2>次のおすすめ</h2>
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
                          ? '前提を練習中'
                          : prereqs.length > 0
                            ? `${names(prereqs)}のつぎ`
                            : '最初の型'}
                      </span>
                    </span>
                  </a>
                  {startButton(s, !check.ok)}
                </li>
              )
            })}
          </ul>
          {atLimit && <LimitNote max={settings.maxActive} />}
        </section>
      )}

      {view === 'list' && locked.length > 0 && (
        <section className="section">
          <h2>その先</h2>
          <p className="muted small">前提はおすすめの順です。やってみたい型から始められます。</p>
          <ul className="type-rows">
            {locked.map((s) => {
              const pending = prereqsOf(s).filter((p) => p.status !== 'done')
              return (
                <li key={s.id} className="type-row">
                  <a href={href(`/skill/${s.id}`)} className="type-row-main">
                    <PatternImage name={s.name} dim />
                    <span className="type-row-text">
                      <span className="type-name">{splitName(s.name).main}</span>
                      <span className="muted small">
                        {pending.length > 0 ? `おすすめ：${names(pending)}のあと` : ''}
                      </span>
                    </span>
                  </a>
                  {startButton(s, atLimit)}
                </li>
              )
            })}
          </ul>
          {atLimit && available.length === 0 && <LimitNote max={settings.maxActive} />}
        </section>
      )}

      {view === 'list' && done.length > 0 && (
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

      {/* 型がまだ無いときは、追加のボタンがすぐ見えるように開いておく */}
      <details className="section manage" open={!current || skills.length === 0}>
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

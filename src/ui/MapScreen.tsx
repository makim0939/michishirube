import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useState } from 'react'
import { db } from '../data/db'
import { practicingSkillIds, recordedSkillIds, recordsOf } from '../data/repo'
import { recentForm, type RecentForm } from '../domain/form'
import { computeStates, indexById, practiceOrder, sortByDepth } from '../domain/logic'
import { formatAgo, splitName } from './common'
import { FormDots } from './FormDots'
import { PlusIcon } from './icons'
import { PatternImage } from './PatternImage'
import { href } from './router'
import { laterLabel, recommendLabel } from './skillLabels'
import { readStorage, writeStorage } from './storage'
import { t } from '../i18n'

const LAST_DOMAIN_KEY = 'michishirube:last-domain'
const VIEW_KEY = 'michishirube:types-view'

// 図の部品（React Flow）は大きいので、ロードマップを開いたときに読み込む（今日の画面の表示を遅くしない）
const RoadmapGraph = lazy(() => import('./RoadmapGraph').then((m) => ({ default: m.RoadmapGraph })))

type View = 'roadmap' | 'list'

export function MapScreen({ domainId }: { domainId?: string }) {
  // 初めは一覧（すぐ始められる）。つながりの図（ロードマップ）に切り替えたら、そちらを覚えておく
  const [view, setView] = useState<View>(() => (readStorage('local', VIEW_KEY) === 'roadmap' ? 'roadmap' : 'list'))
  const changeView = (v: View) => {
    setView(v)
    writeStorage('local', VIEW_KEY, v)
  }

  const data = useLiveQuery(async () => {
    const [domains, allSkills, practicing, recorded] = await Promise.all([
      db.domains.orderBy('order').toArray(),
      db.skills.toArray(),
      practicingSkillIds(),
      recordedSkillIds(),
    ])
    // タブから開いたときは、最後に見ていた分野を出す
    const wanted = domainId ?? readStorage('local', LAST_DOMAIN_KEY)
    const current = domains.find((d) => d.id === wanted) ?? domains[0]
    const skills = current ? allSkills.filter((s) => s.domainId === current.id) : []
    // 練習中の型だけ、杯数と最近の調子、最後に練習した日時（並びに使う）を出す
    const stats = new Map<string, { count: number; form: RecentForm; last: number }>()
    for (const s of skills.filter((s) => practicing.has(s.id) && s.status !== 'done')) {
      const records = await recordsOf(s.id)
      const last = records[0]?.createdAt ?? 0
      stats.set(s.id, { count: records.length, form: recentForm(records), last })
    }
    return { domains, current, skills, stats, practicing, recorded }
  }, [domainId])

  const currentId = data?.current?.id
  useEffect(() => {
    if (currentId) writeStorage('local', LAST_DOMAIN_KEY, currentId)
  }, [currentId])

  if (!data) return null
  const { domains, current, skills, stats, practicing, recorded } = data
  const states = computeStates(skills, practicing)
  const byId = indexById(skills)
  const ordered = sortByDepth(skills)
  // 練習中は、今日の画面と同じ並び（最近練習した順）
  const active = practiceOrder(
    ordered.filter((s) => states.get(s.id) === 'active'),
    (s) => stats.get(s.id)?.last ?? 0,
  )
  const available = ordered.filter((s) => states.get(s.id) === 'available')
  const locked = ordered.filter((s) => states.get(s.id) === 'locked')
  const done = ordered.filter((s) => states.get(s.id) === 'done')

  return (
    <div className="screen types">
      <header className="screen-header">
        <h1>{t.app.tabSkills}</h1>
        {skills.length > 0 && (
          <span className="muted small">
            {t.map.doneCount(done.length, skills.length)}
          </span>
        )}
      </header>

      {domains.length > 1 && (
        <div className="domain-tabs" role="tablist" aria-label={t.map.domains}>
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
        <div className="segmented small view-switch" role="group" aria-label={t.map.view}>
          <button
            type="button"
            className={view === 'list' ? 'selected' : ''}
            aria-pressed={view === 'list'}
            onClick={() => changeView('list')}
          >
            {t.map.list}
          </button>
          <button
            type="button"
            className={view === 'roadmap' ? 'selected' : ''}
            aria-pressed={view === 'roadmap'}
            onClick={() => changeView('roadmap')}
          >
            {t.map.roadmap}
          </button>
        </div>
      )}

      {view === 'roadmap' && current && skills.length > 0 && (
        <>
          <Suspense fallback={<div className="graph" aria-busy="true" />}>
            <RoadmapGraph key={current.id} skills={skills} practicing={practicing} />
          </Suspense>
          <p className="muted small">{t.map.graphHint}</p>
        </>
      )}

      {current && skills.length === 0 && (
        <div className="empty">
          <p>{t.map.noSkills}</p>
          <a className="btn primary" href={href(`/domain/${current.id}/new-skill`)}>
            <PlusIcon size={18} />
            {t.map.addSkill}
          </a>
        </div>
      )}
      {!current && (
        <div className="empty">
          <p>{t.map.noRoadmap}</p>
          <a className="btn primary" href={href('/settings/roadmaps')}>
            {t.map.addRoadmap}
          </a>
        </div>
      )}

      {view === 'list' && active.length > 0 && (
        <section className="section">
          <h2>{t.state.active}</h2>
          <ul className="type-cards">
            {active.map((s) => {
              const st = stats.get(s.id)
              return (
                <li key={s.id}>
                  <a className="type-card" href={href(`/skill/${s.id}`)}>
                    <PatternImage name={s.name} className="large" />
                    <span className="type-card-body">
                      <span className="type-name">{splitName(s.name).main}</span>
                      {st && <FormDots form={st.form} />}
                      <span className="muted small">
                        {t.common.cups(st?.count ?? 0)}
                        {st && st.count > 0 ? t.map.lastPractice(formatAgo(st.last)) : ''}
                      </span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* 次に練習するとよい型（押して型の画面から記録すると、練習中になる） */}
      {view === 'list' && available.length > 0 && (
        <section className="section">
          <h2>{t.state.available}</h2>
          <ul className="type-rows">
            {available.map((s) => (
              <li key={s.id} className="type-row">
                <a href={href(`/skill/${s.id}`)} className="type-row-main">
                  <PatternImage name={s.name} />
                  <span className="type-row-text">
                    <span className="type-name">{splitName(s.name).main}</span>
                    <span className="muted small">{recommendLabel(s, recorded)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* その先の型も、押して型の画面から記録できる */}
      {view === 'list' && locked.length > 0 && (
        <section className="section">
          <h2>{t.state.locked}</h2>
          <ul className="type-rows">
            {locked.map((s) => (
              <li key={s.id} className="type-row">
                <a href={href(`/skill/${s.id}`)} className="type-row-main">
                  <PatternImage name={s.name} dim />
                  <span className="type-row-text">
                    <span className="type-name">{splitName(s.name).main}</span>
                    <span className="muted small">{laterLabel(s, byId)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === 'list' && done.length > 0 && (
        <section className="section done-section">
          <h2>{t.state.done}</h2>
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

      {/* 自分の型を足す（分野やロードマップの管理は、設定の「ロードマップ」に） */}
      {current && skills.length > 0 && (
        <a className="add-type" href={href(`/domain/${current.id}/new-skill`)}>
          <PlusIcon size={16} />
          {t.map.addSkillTo(current.name)}
        </a>
      )}
    </div>
  )
}

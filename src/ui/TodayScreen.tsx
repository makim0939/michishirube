import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../data/db'
import { activateSkill, getSettings, recordsOf } from '../data/repo'
import { getSyncConfig, getSyncStatus } from '../data/sync'
import { computeStates, indexById, prereqsDone, sortByDepth } from '../domain/logic'
import type { Media, PracticeRecord, Skill } from '../domain/types'
import { formatAgo, OUTCOME_MARK, splitName, useObjectUrl } from './common'
import { hasPhoto, pickCupMedia, useCupImage } from './cupImage'
import { useAction, useToast } from './feedback'
import { AlertIcon, CameraIcon } from './icons'
import { href } from './router'
import { readStorage, writeStorage } from './storage'
import { LIGHT_LABEL, lightFor, lightUrl, patternFor, patternUrl } from './world'

const HINT_KEY = 'michishirube:install-hint-dismissed'
/** メイン写真を探しにいく、新しい記録の数 */
const HERO_LOOKBACK = 20
const RECENT = 4

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function startOfWeek(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  // 週は月曜から
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIos() {
  // iPadOS の Safari は Mac として名乗るので、タッチ対応かどうかでも判定する
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

/**
 * 気にしてほしいことを1行だけ出す。同期の失敗 → 記録が端末にしかない → ホーム画面に追加、の順に大事
 */
function Notice() {
  const [hintHidden, setHintHidden] = useState(() => readStorage('local', HINT_KEY) === '1')
  const data = useLiveQuery(async () => ({
    config: await getSyncConfig(),
    status: await getSyncStatus(),
    records: await db.records.count(),
    uploads: await db.media.where('upload').anyOf('pending', 'uploading').count(),
    failed: await db.media.where('upload').equals('failed').count(),
  }))
  if (!data) return null

  if (data.config && data.status.error) {
    return (
      <a className="notice" href={href('/settings')}>
        <AlertIcon size={18} />
        <span>同期できていません。設定を確かめてください</span>
      </a>
    )
  }
  if (!data.config && data.records > 0) {
    return (
      <a className="notice" href={href('/settings')}>
        <AlertIcon size={18} />
        <span>記録はまだこの端末だけです。設定からクラウド同期をつなぐと、消えても戻せます</span>
      </a>
    )
  }
  if (!hintHidden && isIos() && !isStandalone()) {
    return (
      <div className="notice">
        <AlertIcon size={18} />
        <span>共有ボタン →「ホーム画面に追加」から開くと、記録が消えにくくなります</span>
        <button
          className="notice-close"
          aria-label="閉じる"
          onClick={() => {
            writeStorage('local', HINT_KEY, '1')
            setHintHidden(true)
          }}
        >
          ×
        </button>
      </div>
    )
  }
  if (data.failed > 0) {
    return (
      <p className="notice quiet">YouTube へのアップに失敗した動画が {data.failed} 本あります。次に開いたときに上げ直します</p>
    )
  }
  if (data.uploads > 0) {
    return <p className="notice quiet">YouTube へのアップ待ちの動画が {data.uploads} 本あります（開いている間に上げます）</p>
  }
  return null
}

function Hero({
  media,
  record,
  number,
  skillName,
}: {
  media?: Media
  record?: PracticeRecord
  number?: number
  skillName?: string
}) {
  const blob = useCupImage(media)
  const url = useObjectUrl(blob, media ? `${media.id}-hero-${blob?.size ?? 0}` : undefined)
  const now = new Date()
  const light = lightFor(now)
  const date = `${now.getMonth() + 1}.${now.getDate()} ${WEEKDAYS[now.getDay()]} · ${LIGHT_LABEL[light]}`
  // 自分の写真が無いあいだは、いまの時刻の光の絵を出す（自分の1杯ではないので説明は付けない）
  const own = !!media && !!url
  return (
    <section className="today-hero" aria-label={own ? '最新の1杯' : undefined}>
      <img
        className="hero-image"
        src={own ? url : lightUrl(light)}
        alt={own ? `No.${number} ${skillName ?? ''}` : ''}
      />
      <div className="hero-shade" aria-hidden="true" />
      <div className="hero-top">
        <span className="wordmark">Latelier</span>
        <span className="hero-date">{date}</span>
      </div>
      {own && record && (
        <div className="hero-caption">
          <span className="hero-no">No.{number}</span>
          <span>
            {formatAgo(record.createdAt)}
            {skillName && `　${splitName(skillName).main}`}
            {record.outcome && `　${OUTCOME_MARK[record.outcome]}`}
          </span>
        </div>
      )}
    </section>
  )
}

function RecentCup({ record, media, number, skillId }: { record: PracticeRecord; media?: Media; number: number; skillId: string }) {
  const blob = useCupImage(media)
  const url = useObjectUrl(blob, media ? `${media.id}-thumb-${blob?.size ?? 0}` : undefined)
  return (
    <li>
      <a className="recent-cup" href={href(`/skill/${skillId}`)}>
        {url ? <img src={url} alt="" /> : <span className="recent-empty" aria-hidden="true" />}
        <span className="recent-no">
          No.{number}
          {record.outcome && ` ${OUTCOME_MARK[record.outcome]}`}
        </span>
      </a>
    </li>
  )
}

type Focus = {
  skill: Skill
  count: number
  next?: { text: string; at: number }
}

export function TodayScreen() {
  const run = useAction()
  const toast = useToast()
  const [focusId, setFocusId] = useState<string>()

  const data = useLiveQuery(async () => {
    const [skills, settings, total] = await Promise.all([db.skills.toArray(), getSettings(), db.records.count()])
    const byId = indexById(skills)
    const states = computeStates(skills)
    const active = skills
      .filter((s) => s.status === 'active')
      .sort((a, b) => (a.activatedAt ?? 0) - (b.activatedAt ?? 0))
    const focus: Focus[] = await Promise.all(
      active.map(async (skill) => {
        const records = await recordsOf(skill.id)
        const next = records.find((r) => r.nextAction)
        return { skill, count: records.length, next: next && { text: next.nextAction, at: next.createdAt } }
      }),
    )
    // 新しい記録から、メイン写真にする1杯と、最近の杯を選ぶ
    const latest = await db.records.orderBy('createdAt').reverse().limit(HERO_LOOKBACK).toArray()
    const mediaOf = await Promise.all(latest.map(async (r) => pickCupMedia(await db.media.bulkGet(r.mediaIds))))
    const numbered = latest.map((record, i) => ({ record, media: mediaOf[i], number: total - i }))
    const hero = numbered.find((n) => hasPhoto(n.media))
    const thisWeek = await db.records.where('createdAt').aboveOrEqual(startOfWeek(Date.now())).count()
    // 前提を達成済みの「次の一歩」を先に、前提を練習中で並行して挑戦できるものを後に並べる
    const available = sortByDepth(skills.filter((s) => states.get(s.id) === 'available'))
      .map((s) => ({ ...s, parallel: !prereqsDone(s, byId) }))
      .sort((a, b) => Number(a.parallel) - Number(b.parallel))
    return {
      settings,
      total,
      thisWeek,
      focus,
      hero: hero && { ...hero, skillName: byId.get(hero.record.skillId)?.name },
      recent: numbered.slice(0, RECENT),
      available,
      skillCount: skills.length,
    }
  })

  if (!data) return null
  const current = data.focus.find((f) => f.skill.id === focusId) ?? data.focus[data.focus.length - 1]
  const room = data.settings.maxActive - data.focus.length

  return (
    <div className="screen today">
      <Hero
        media={data.hero?.media}
        record={data.hero?.record}
        number={data.hero?.number}
        skillName={data.hero?.skillName}
      />

      <div className="today-sheet">
        <Notice />

        {current ? (
          <>
            <div className="sheet-head">
              <h2>練習中の型</h2>
              <span className="muted small">
                この型 {current.count}杯 · 今週 {data.thisWeek}杯
              </span>
            </div>
            <div className="focus-title">
              {patternFor(current.skill.name) && (
                <img className="focus-pattern" src={patternUrl(patternFor(current.skill.name)!)} alt="" />
              )}
              <div>
                <h1>{splitName(current.skill.name).main}</h1>
                {splitName(current.skill.name).sub && (
                  <p className="muted small">{splitName(current.skill.name).sub}</p>
                )}
              </div>
            </div>
            {data.focus.length > 1 && (
              <div className="focus-switch" role="group" aria-label="練習中の型を切り替える">
                {data.focus.map((f) => (
                  <button
                    key={f.skill.id}
                    type="button"
                    aria-pressed={f.skill.id === current.skill.id}
                    onClick={() => setFocusId(f.skill.id)}
                  >
                    {splitName(f.skill.name).main}
                  </button>
                ))}
              </div>
            )}
            <p className="next-line">
              <span className="next-label">次の一手</span>
              <span className={current.next ? 'next-text' : 'next-text none'}>
                {current.next ? current.next.text : 'まだありません。撮ったあとに書いておくと、ここに出ます'}
              </span>
            </p>
            <a className="btn primary shoot" href={href(`/record/${current.skill.id}/camera`)}>
              <CameraIcon size={22} />
              {data.total + 1}杯目を撮る
            </a>
            <a className="sub-link" href={href(`/skill/${current.skill.id}`)}>
              合格の目安・やり方を見る
            </a>
          </>
        ) : data.skillCount > 0 ? (
          <div className="sheet-empty">
            <h2>練習中の型</h2>
            <p>まだ選んでいません。下から1つ選ぶと、ここから撮れるようになります。</p>
          </div>
        ) : (
          <div className="sheet-empty">
            <p>型がありません。</p>
            <a className="btn primary" href={href('/map')}>
              型を用意する
            </a>
          </div>
        )}

        {data.recent.length > 0 && (
          <section className="recent">
            <div className="sheet-head">
              <h2>最近の杯</h2>
              <a className="small" href={href('/records')}>
                カップ帳を見る
              </a>
            </div>
            <ul className="recent-cups">
              {data.recent.map((n) => (
                <RecentCup
                  key={n.record.id}
                  record={n.record}
                  media={n.media}
                  number={n.number}
                  skillId={n.record.skillId}
                />
              ))}
            </ul>
          </section>
        )}

        {data.available.length > 0 && room > 0 && (
          <section className="section">
            <h2>挑戦できる型</h2>
            <ul className="list">
              {data.available.map((s) => (
                <li key={s.id} className="list-row">
                  {patternFor(s.name) ? (
                    <img className="row-pattern" src={patternUrl(patternFor(s.name)!)} alt="" />
                  ) : null}
                  <a href={href(`/skill/${s.id}`)} className="list-main">
                    <span>{splitName(s.name).main}</span>
                    <span className="list-sub">
                      {[splitName(s.name).sub, s.parallel && '前提と並行して練習できる'].filter(Boolean).join('・')}
                    </span>
                  </a>
                  <button
                    className="btn small"
                    onClick={() =>
                      run(async () => {
                        await activateSkill(s.id)
                        setFocusId(s.id)
                        toast.show(`「${splitName(s.name).main}」の練習を始めます`)
                      })
                    }
                  >
                    はじめる
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.available.length > 0 && room <= 0 && (
          <p className="muted small">
            ほかに挑戦できる型が {data.available.length} つあります。練習中は {data.settings.maxActive}{' '}
            つまでなので、どれかを「できた」にするか練習をやめると選べます。
          </p>
        )}
      </div>
    </div>
  )
}

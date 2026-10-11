import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../data/db'
import { activateSkill, getSettings, recordsOf } from '../data/repo'
import { getSyncConfig, getSyncStatus } from '../data/sync'
import { computeStates, indexById, orderBy, prereqsDone, sortByDepth } from '../domain/logic'
import type { Media, PracticeRecord, Skill } from '../domain/types'
import { OUTCOME_MARK } from '../domain/format'
import { formatAgo, splitName, useObjectUrl } from './common'
import { hasPhoto, pickCupMedia, useCupImage } from './cupImage'
import { useAction, useToast } from './feedback'
import { FocusOrder } from './FocusOrder'
import { AlertIcon, CameraIcon } from './icons'
import { href } from './router'
import { readStorage, writeStorage } from './storage'
import { PatternImage } from './PatternImage'
import { LIGHT_LABEL, lightFor, lightUrl } from './world'

const HINT_KEY = 'michishirube:install-hint-dismissed'
/** メイン写真を探しにいく、新しい記録の数 */
const HERO_LOOKBACK = 20
const RECENT = 4

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** いまの時刻。開いたままや、裏から戻ったときにも、日付と光が古いままにならないようにする */
function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const timer = setInterval(tick, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return now
}

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
 * 気にしてほしいことを1行だけ出す。同期の失敗 → ホーム画面に追加（閉じられる）→ 記録が端末にしかない、の順に大事。
 * ホーム画面に追加しないと Safari が記録を消すことがあるので、同期をつないでいなくても先に出す
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
  if (!data.config && data.records > 0) {
    return (
      <a className="notice" href={href('/settings')}>
        <AlertIcon size={18} />
        <span>記録はまだこの端末だけです。設定からクラウド同期をつなぐと、消えても戻せます</span>
      </a>
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
  const now = useNow()
  const light = lightFor(now)
  const date = `${now.getMonth() + 1}.${now.getDate()} ${WEEKDAYS[now.getDay()]} · ${LIGHT_LABEL[light]}`
  // 自分の写真が無いあいだは、いまの時刻の光の絵を出す（自分の1杯ではないので説明は付けない）
  const own = !!media && !!url
  return (
    <section className="today-hero" aria-label={own ? '最新の1杯' : undefined}>
      <img
        className="hero-image"
        src={own ? url : lightUrl(light)}
        alt={own ? `${skillName ?? ''} ${number}杯目` : ''}
      />
      <div className="hero-shade" aria-hidden="true" />
      <div className="hero-top">
        <span className="wordmark">Latelier</span>
        <span className="hero-date">{date}</span>
      </div>
      {own && record && (
        <div className="hero-caption">
          <span className="hero-no">
            {number}
            <small>杯目</small>
          </span>
          <span>
            {formatAgo(record.createdAt, now.getTime())}
            {skillName && `　${splitName(skillName).main}`}
            {record.outcome && `　${OUTCOME_MARK[record.outcome]}`}
          </span>
        </div>
      )}
    </section>
  )
}

function RecentCup({ record, media, label }: { record: PracticeRecord; media?: Media; label: string }) {
  const blob = useCupImage(media)
  const url = useObjectUrl(blob, media ? `${media.id}-thumb-${blob?.size ?? 0}` : undefined)
  return (
    <li>
      {/* 押すと、その1杯の動画・写真と理由を見返せる */}
      <a className="recent-cup" href={href(`/cup/${record.id}`)} aria-label={`${label}の詳細`}>
        {url ? <img src={url} alt="" /> : <span className="recent-empty" aria-hidden="true" />}
        <span className="recent-no">
          {label}
          {record.outcome && ` ${OUTCOME_MARK[record.outcome]}`}
        </span>
      </a>
    </li>
  )
}

type Practice = {
  skill: Skill
  count: number
  next?: string
  /** その型の新しい杯（その型の何杯目か付き） */
  recent: { record: PracticeRecord; media?: Media; number: number }[]
}

/** 練習中の型1つ分。次の一手・記録する・その型の最近の杯を、この型の中にまとめる */
function PracticeBlock({ practice }: { practice: Practice }) {
  const { skill, count, next, recent } = practice
  const { main, sub } = splitName(skill.name)
  return (
    <section className="practice-block" aria-label={main}>
      <a className="practice-head" href={href(`/skill/${skill.id}`)}>
        <PatternImage name={skill.name} />
        <span className="practice-title">
          <span className="practice-name">{main}</span>
          {sub && <span className="muted small">{sub}</span>}
        </span>
        <span className="practice-count">
          <strong>{count}</strong>杯
        </span>
      </a>
      <p className="next-line">
        <span className="next-label">次の一手</span>
        <span className={next ? 'next-text' : 'next-text none'}>
          {next ?? 'まだありません。記録のときに書いておくと、ここに出ます'}
        </span>
      </p>
      <a className="btn primary shoot" href={href(`/record/${skill.id}`)}>
        <CameraIcon size={20} />
        {count + 1}杯目を記録する
      </a>
      {recent.length > 0 && (
        <ul className="recent-cups" aria-label={`${main}の最近の杯`}>
          {recent.map((r) => (
            <RecentCup key={r.record.id} record={r.record} media={r.media} label={`${r.number}杯目`} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function TodayScreen() {
  const run = useAction()
  const toast = useToast()
  const [reordering, setReordering] = useState(false)

  const data = useLiveQuery(async () => {
    const [skills, settings] = await Promise.all([db.skills.toArray(), getSettings()])
    const byId = indexById(skills)
    const states = computeStates(skills)
    const active = skills.filter((s) => s.status === 'active')
    const perSkill = await Promise.all(active.map(async (skill) => ({ skill, records: await recordsOf(skill.id) })))
    // 新しい記録から、メイン写真にする1杯を選ぶ
    const latest = await db.records.orderBy('createdAt').reverse().limit(HERO_LOOKBACK).toArray()
    // 動画・写真は、メイン写真の候補と各型の最近の杯の分をまとめて1回で読む
    const recentOf = perSkill.map(({ records }) => records.slice(0, RECENT))
    const mediaIds = [...latest, ...recentOf.flat()].flatMap((r) => r.mediaIds ?? [])
    const media = await db.media.bulkGet([...new Set(mediaIds)])
    const mediaById = new Map(media.filter((m) => !!m).map((m) => [m.id, m]))
    const cupOf = (r: PracticeRecord) => pickCupMedia((r.mediaIds ?? []).map((id) => mediaById.get(id)))
    const heroRecord = latest.find((r) => hasPhoto(cupOf(r)))
    // メイン写真の杯も、型ごとのまとまりと同じく「その型の何杯目か」で数える
    const heroNumber =
      heroRecord &&
      (await db.records
        .where('[skillId+createdAt]')
        .between([heroRecord.skillId, -Infinity], [heroRecord.skillId, heroRecord.createdAt], true, true)
        .count())
    // 練習中ではない型（できた・並行して記録した型）の新しい杯も、ホームで見返せるようにする
    const activeIds = new Set(active.map((s) => s.id))
    const others = latest
      .filter((r) => !activeIds.has(r.skillId))
      .slice(0, RECENT)
      .map((record) => ({ record, media: cupOf(record), name: splitName(byId.get(record.skillId)?.name ?? '').main }))
    const byLast = perSkill
      .map(({ skill, records }, i) => ({
        skill,
        count: records.length,
        next: records.find((r) => r.nextAction)?.nextAction,
        recent: recentOf[i].map((record, j) => ({ record, media: cupOf(record), number: records.length - j })),
        last: records[0]?.createdAt ?? skill.activatedAt ?? 0,
      }))
      // 並びを決めていない型は、最近練習した順
      .sort((a, b) => b.last - a.last)
    // 利用者が並べ替えた順を優先する（いま集中している型を上に）
    const practices: Practice[] = orderBy(byLast, settings.focusOrder, (p) => p.skill.id)
    const thisWeek = await db.records.where('createdAt').aboveOrEqual(startOfWeek(Date.now())).count()
    // 前提を達成済みの「次の一歩」を先に、前提を練習中で並行して挑戦できるものを後に並べる
    const available = sortByDepth(skills.filter((s) => states.get(s.id) === 'available'))
      .map((s) => ({ ...s, parallel: !prereqsDone(s, byId) }))
      .sort((a, b) => Number(a.parallel) - Number(b.parallel))
    return {
      settings,
      thisWeek,
      practices,
      others,
      hero: heroRecord && {
        record: heroRecord,
        media: cupOf(heroRecord),
        number: heroNumber ?? 0,
        skillName: byId.get(heroRecord.skillId)?.name,
      },
      available,
      skillCount: skills.length,
    }
  })

  if (!data) return null
  // 練習中が1つになったら並べ替えを終える（次に2つになったとき、勝手に並べ替えの画面にならないように）
  if (reordering && data.practices.length <= 1) setReordering(false)
  const room = data.settings.maxActive - data.practices.length

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

        {data.practices.length > 0 ? (
          <>
            <div className="sheet-head">
              <h2>練習中の型</h2>
              <span className="muted small">
                今週 {data.thisWeek}杯 ·{' '}
                <a href={href('/records')}>カップ帳</a>
                {data.practices.length > 1 && !reordering && (
                  <>
                    {' · '}
                    <button type="button" className="link-button" onClick={() => setReordering(true)}>
                      並べ替え
                    </button>
                  </>
                )}
              </span>
            </div>
            {reordering && data.practices.length > 1 ? (
              <FocusOrder skills={data.practices.map((p) => p.skill)} onDone={() => setReordering(false)} />
            ) : (
              data.practices.map((p) => <PracticeBlock key={p.skill.id} practice={p} />)
            )}
          </>
        ) : data.skillCount > 0 ? (
          <div className="sheet-empty">
            <h2>練習中の型</h2>
            {data.available.length > 0 ? (
              <p>まだ選んでいません。下から1つ選ぶと、ここから記録できるようになります。</p>
            ) : (
              <>
                <p>いま挑戦できる型はありません。型の画面で、次の型を足せます。</p>
                <a className="btn" href={href('/map')}>
                  型の画面を開く
                </a>
              </>
            )}
          </div>
        ) : (
          <div className="sheet-empty">
            <p>型がありません。</p>
            <a className="btn primary" href={href('/map')}>
              型を用意する
            </a>
          </div>
        )}

        {data.others.length > 0 && (
          <section className="section">
            <h2>ほかの型の最近の杯</h2>
            <ul className="recent-cups">
              {data.others.map((o) => (
                <RecentCup key={o.record.id} record={o.record} media={o.media} label={o.name} />
              ))}
            </ul>
          </section>
        )}

        {data.available.length > 0 && room > 0 && (
          <section className="section">
            <h2>挑戦できる型</h2>
            <ul className="type-rows">
              {data.available.map((s) => (
                <li key={s.id} className="type-row">
                  <a href={href(`/skill/${s.id}`)} className="type-row-main">
                    <PatternImage name={s.name} className="small" />
                    <span className="type-row-text">
                      <span className="type-name">{splitName(s.name).main}</span>
                      <span className="muted small">
                        {s.parallel ? '前提と並行して練習できる' : (splitName(s.name).sub ?? '')}
                      </span>
                    </span>
                  </a>
                  <button
                    className="btn small"
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

import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../data/db'
import { activateSkill, cupNumbers, getSettings, recordsOf, setFocusOrder } from '../data/repo'
import { getSyncConfig, getSyncStatus } from '../data/sync'
import { computeStates, indexById, moveItem, orderBy, practiceOrder, prereqsDone, sortByDepth } from '../domain/logic'
import type { Media, PracticeRecord, Skill } from '../domain/types'
import { OUTCOME_MARK } from '../domain/format'
import { formatAgo, splitName, useObjectUrl } from './common'
import { pickCupMedia, useCupImage } from './cupImage'
import { hasCupImage } from '../data/poster'
import { useAction, useToast } from './feedback'
import { useLongPressReorder } from './useLongPressReorder'
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
            {formatAgo(record.createdAt, now.getTime())}
            {skillName && `　${splitName(skillName).main}`}
            {record.outcome && `　${OUTCOME_MARK[record.outcome]}`}
          </span>
        </div>
      )}
    </section>
  )
}

function RecentCup({
  record,
  media,
  label,
  name,
}: {
  record: PracticeRecord
  media?: Media
  label: string
  /** 読み上げ用に添える型の名前（ほかの型の杯） */
  name?: string
}) {
  const blob = useCupImage(media)
  const url = useObjectUrl(blob, media ? `${media.id}-thumb-${blob?.size ?? 0}` : undefined)
  return (
    <li>
      {/* 押すと、その1杯の動画・写真と理由を見返せる */}
      <a className="recent-cup" href={href(`/cup/${record.id}`)} aria-label={`${name ? `${name} ` : ''}${label}の詳細`}>
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
  /** その型の新しい杯（通し番号つき） */
  recent: { record: PracticeRecord; media?: Media; number: number }[]
}

/** 練習中の型1つ分。次の一手・記録する・その型の最近の杯を、この型の中にまとめる */
function PracticeBlock({
  practice,
  compact,
  lifted,
  onMove,
}: {
  practice: Practice
  /** 並べ替えている間は、見出しだけにたたむ */
  compact: boolean
  /** この型を持ち上げて動かしている */
  lifted: boolean
  /** 読み上げで使う人のための並べ替え（-1 で上へ、1 で下へ）。動かせないときは undefined */
  onMove?: { up?: () => void; down?: () => void }
}) {
  const { skill, count, next, recent } = practice
  const { main, sub } = splitName(skill.name)
  return (
    <section
      className={`practice-block${compact ? ' compact' : ''}${lifted ? ' lifted' : ''}`}
      aria-label={main}
      data-reorder-id={skill.id}
    >
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
      {!compact && (
        <>
          {/* 次の一手は、書いたことがあるときだけ出す（無いときの説明は記録画面にある） */}
          {next && (
            <p className="next-line">
              <span className="next-label">次の一手</span>
              <span className="next-text">{next}</span>
            </p>
          )}
          <a className="btn primary shoot" href={href(`/record/${skill.id}`)}>
            <CameraIcon size={20} />
            {/* 記録ボタンは、その型で何杯目か（杯の No. は全体の通し番号） */}
            {count + 1}杯目を記録する
          </a>
          {recent.length > 0 && (
            <ul className="recent-cups" aria-label={`${main}の最近の杯`}>
              {recent.map((r) => (
                <RecentCup key={r.record.id} record={r.record} media={r.media} label={`No.${r.number}`} />
              ))}
            </ul>
          )}
        </>
      )}
      {onMove?.up && (
        <button type="button" className="sr-only" onClick={onMove.up}>
          「{main}」を上へ
        </button>
      )}
      {onMove?.down && (
        <button type="button" className="sr-only" onClick={onMove.down}>
          「{main}」を下へ
        </button>
      )}
    </section>
  )
}

export function TodayScreen() {
  const run = useAction()
  const toast = useToast()

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
    // 写真、または動画のできあがりのコマがある、いちばん新しい杯
    const heroRecord = latest.find((r) => hasCupImage(cupOf(r)))
    // 練習中ではない型（できた・並行して記録した型）の新しい杯も、ホームで見返せるようにする
    const activeIds = new Set(active.map((s) => s.id))
    const others = latest
      .filter((r) => !activeIds.has(r.skillId))
      .slice(0, RECENT)
      .map((record) => ({ record, media: cupOf(record), name: splitName(byId.get(record.skillId)?.name ?? '').main }))
    // 杯の番号は、型に関係なく全部の記録の通し番号（No.）
    const numbered = [...recentOf.flat(), ...others.map((o) => o.record), ...(heroRecord ? [heroRecord] : [])]
    const numbers = await cupNumbers([...new Map(numbered.map((r) => [r.id, r])).values()])
    const unordered = perSkill.map(({ skill, records }, i) => ({
      skill,
      count: records.length,
      next: records.find((r) => r.nextAction)?.nextAction,
      recent: recentOf[i].map((record) => ({ record, media: cupOf(record), number: numbers.get(record.id) ?? 0 })),
      last: records[0]?.createdAt ?? skill.activatedAt ?? 0,
    }))
    // 利用者が並べ替えた順を優先し、決めていない型は最近練習した順（いま集中している型を上に）
    const practices: Practice[] = practiceOrder(
      unordered,
      settings.focusOrder,
      (p) => p.skill.id,
      (p) => p.last,
    )
    const thisWeek = await db.records.where('createdAt').aboveOrEqual(startOfWeek(Date.now())).count()
    // 次のおすすめ：前提ができている「次の一歩」を先に、前提を練習中のものを後に並べる
    const available = sortByDepth(skills.filter((s) => states.get(s.id) === 'available'))
      .map((s) => ({ ...s, parallel: !prereqsDone(s, byId) }))
      .sort((a, b) => Number(a.parallel) - Number(b.parallel))
    return {
      settings,
      thisWeek,
      practices,
      others: others.map((o) => ({ ...o, number: numbers.get(o.record.id) ?? 0 })),
      hero: heroRecord && {
        record: heroRecord,
        media: cupOf(heroRecord),
        number: numbers.get(heroRecord.id) ?? 0,
        skillName: byId.get(heroRecord.skillId)?.name,
      },
      available,
      skillCount: skills.length,
    }
  })

  // 型のカードを長押しして動かすと並べ替えられる（いま集中している型を上に）
  const saveOrder = async (next: string[]) =>
    (await run(async () => {
      await setFocusOrder(next)
      return true
    })) === true
  const { containerRef, order, dragging } = useLongPressReorder(data?.practices.map((p) => p.skill.id) ?? [], saveOrder)

  if (!data) return null
  // 動かしている間の並び（読み込み直後でまだ並びが無い型は、元の並びのまま）
  const shown = orderBy(data.practices, order, (p) => p.skill.id)
  const shownIds = shown.map((p) => p.skill.id)
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
                {data.practices.length > 1 && ' · 長押しで並べ替え'}
              </span>
            </div>
            <div className="practice-list" ref={containerRef}>
              {shown.map((p, i) => (
                <PracticeBlock
                  key={p.skill.id}
                  practice={p}
                  compact={dragging !== null}
                  lifted={dragging === p.skill.id}
                  onMove={{
                    up: i > 0 ? () => void saveOrder(moveItem(shownIds, i, i - 1)) : undefined,
                    down: i < shown.length - 1 ? () => void saveOrder(moveItem(shownIds, i, i + 1)) : undefined,
                  }}
                />
              ))}
            </div>
          </>
        ) : data.skillCount > 0 ? (
          <div className="sheet-empty">
            <h2>練習中の型</h2>
            {data.available.length > 0 ? (
              <p>まだ選んでいません。下から1つ選ぶと、ここから記録できるようになります。</p>
            ) : (
              <>
                <p>次のおすすめの型はありません。型の画面から、やってみたい型を選べます。</p>
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
                <RecentCup key={o.record.id} record={o.record} media={o.media} label={`No.${o.number}`} name={o.name} />
              ))}
            </ul>
          </section>
        )}

        {data.available.length > 0 && room > 0 && (
          <section className="section">
            <div className="sheet-head">
              <h2>次のおすすめ</h2>
              <a className="small" href={href('/map')}>
                ほかの型から選ぶ
              </a>
            </div>
            <ul className="type-rows">
              {data.available.map((s) => (
                <li key={s.id} className="type-row">
                  <a href={href(`/skill/${s.id}`)} className="type-row-main">
                    <PatternImage name={s.name} className="small" />
                    <span className="type-row-text">
                      <span className="type-name">{splitName(s.name).main}</span>
                      <span className="muted small">
                        {s.parallel ? '前提を練習中' : (splitName(s.name).sub ?? '')}
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
            次のおすすめの型が {data.available.length} つあります。練習中は {data.settings.maxActive}{' '}
            つまでなので、どれかを「できた」にするか練習を中断すると始められます。
          </p>
        )}
      </div>
    </div>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db } from '../data/db'
import { activateSkill, cupNumbers, getSettings, recordsOf, setFocusOrder } from '../data/repo'
import { getSyncConfig, getSyncStatus } from '../data/sync'
import { computeStates, indexById, moveItem, orderBy, practiceOrder, prereqsDone, sortByDepth } from '../domain/logic'
import type { Media, PracticeRecord, Skill } from '../domain/types'
import { recentForm, type RecentForm } from '../domain/form'
import { OUTCOME_MARK } from '../domain/format'
import { formatAgo, splitName, useObjectUrl } from './common'
import { pickCupMedia, useCupImage } from './cupImage'
import { hasCupImage } from '../data/poster'
import { useAction, useToast } from './feedback'
import { FormDots } from './FormDots'
import { useLongPressReorder } from './useLongPressReorder'
import { AlertIcon, CameraIcon } from './icons'
import { href } from './router'
import { readStorage, writeStorage } from './storage'
import { PatternImage } from './PatternImage'
import { LIGHT_LABEL, lightFor, lightUrl, type Light } from './world'

const HINT_KEY = 'michishirube:install-hint-dismissed'
/** メイン写真を探しにいく、新しい記録の数 */
const HERO_LOOKBACK = 20
/** 大きな写真でめくれる、最近の杯の数 */
const HERO_SLIDES = 6
/** 型ごとの最近の杯（横にスクロールして見る） */
const RECENT = 12

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

type Slide = {
  record: PracticeRecord
  media?: Media
  number: number
  skillName?: string
  /** いちばん最初の1杯（いまと見比べられるよう、最後に置く） */
  first?: boolean
}

/**
 * 大きな写真の1枚と、その説明。写真がまだ読めないあいだは、いまの時刻の光の絵を出し、説明は付けない
 * （自分の1杯ではない絵に、No. を付けないように）
 */
function HeroSlide({ slide, light, now }: { slide: Slide; light: Light; now: Date }) {
  const blob = useCupImage(slide.media)
  const url = useObjectUrl(blob, slide.media ? `${slide.media.id}-hero-${blob?.size ?? 0}` : undefined)
  return (
    <div className="hero-slide">
      <img
        className="hero-image"
        src={url ?? lightUrl(light)}
        alt={url ? `No.${slide.number} ${slide.skillName ? splitName(slide.skillName).main : ''}` : ''}
      />
      {url && (
        <div className="hero-caption">
          {slide.first && <span className="hero-first">はじまりの1杯</span>}
          <span className="hero-no">No.{slide.number}</span>
          <span>
            {formatAgo(slide.record.createdAt, now.getTime())}
            {slide.skillName && `　${splitName(slide.skillName).main}`}
            {slide.record.outcome && `　${OUTCOME_MARK[slide.record.outcome]}`}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * 今日の画面のいちばん上。最近の杯の写真を左右にめくれて、最後の1枚は「はじまりの1杯」（いまと見比べる）。
 * 写真がまだ無いあいだは、いまの時刻の光の絵を出す
 */
function Hero({ slides }: { slides: Slide[] }) {
  const now = useNow()
  const light = lightFor(now)
  const date = `${now.getMonth() + 1}.${now.getDate()} ${WEEKDAYS[now.getDay()]} · ${LIGHT_LABEL[light]}`
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  // 新しい杯を記録したら、いちばん新しい1枚に戻す
  const newest = slides[0]?.record.id
  useEffect(() => {
    track.current?.scrollTo({ left: 0 })
    setIndex(0)
  }, [newest])

  return (
    <section className="today-hero" aria-label={slides.length > 0 ? '最近の杯（左右にめくれます）' : undefined}>
      {slides.length === 0 ? (
        <img className="hero-image" src={lightUrl(light)} alt="" />
      ) : (
        <div
          className="hero-track"
          ref={track}
          onScroll={(e) => {
            const el = e.currentTarget
            setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
          }}
        >
          {slides.map((s) => (
            <HeroSlide key={s.record.id} slide={s} light={light} now={now} />
          ))}
        </div>
      )}
      <div className="hero-shade" aria-hidden="true" />
      <div className="hero-top">
        <span className="wordmark">Latelier</span>
        <span className="hero-date">{date}</span>
      </div>
      {slides.length > 1 && (
        <div className="hero-dots" aria-hidden="true">
          {slides.map((s, i) => (
            <span key={s.record.id} className={i === index ? 'on' : ''} />
          ))}
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
  /** 最近の調子（直近10杯の結果） */
  form: RecentForm
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
  const { skill, count, next, recent, form } = practice
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
          {/* 最近の調子（直近10杯）。文字を増やさず、点だけで */}
          {!compact && <FormDots form={form} />}
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
    // 新しい記録から、大きな写真でめくる杯を選ぶ。最後に「はじまりの1杯」（いちばん古い、写真のある杯）を置く
    const [latest, firstMedia] = await Promise.all([
      db.records.orderBy('createdAt').reverse().limit(HERO_LOOKBACK).toArray(),
      // いちばん古い写真。古い順にたどって最初に見つかったもの
      db.media.orderBy('createdAt').filter((m) => hasCupImage(m)).first(),
    ])
    const firstCandidate = firstMedia && (await db.records.get(firstMedia.recordId))
    // 動画・写真は、大きな写真の候補と各型の最近の杯の分をまとめて1回で読む
    const recentOf = perSkill.map(({ records }) => records.slice(0, RECENT))
    const mediaIds = [...latest, ...(firstCandidate ? [firstCandidate] : []), ...recentOf.flat()].flatMap(
      (r) => r.mediaIds ?? [],
    )
    const media = await db.media.bulkGet([...new Set(mediaIds)])
    const mediaById = new Map(media.filter((m) => !!m).map((m) => [m.id, m]))
    const cupOf = (r: PracticeRecord) => pickCupMedia((r.mediaIds ?? []).map((id) => mediaById.get(id)))
    // 写真のある杯（動画のコマは、きれいにカップが写っているとは限らないので使わない）
    const heroRecords = latest.filter((r) => hasCupImage(cupOf(r))).slice(0, HERO_SLIDES)
    const firstRecord = firstCandidate && hasCupImage(cupOf(firstCandidate)) ? firstCandidate : undefined
    const withFirst = firstRecord && !heroRecords.some((r) => r.id === firstRecord.id)
    // 練習中ではない型（できた・並行して記録した型）の新しい杯も、ホームで見返せるようにする
    const activeIds = new Set(active.map((s) => s.id))
    const others = latest
      .filter((r) => !activeIds.has(r.skillId))
      .slice(0, RECENT)
      .map((record) => ({ record, media: cupOf(record), name: splitName(byId.get(record.skillId)?.name ?? '').main }))
    const heroAll = withFirst ? [...heroRecords, firstRecord] : heroRecords
    // 杯の番号は、型に関係なく全部の記録の通し番号（No.）
    const numbered = [...recentOf.flat(), ...others.map((o) => o.record), ...heroAll]
    const numbers = await cupNumbers([...new Map(numbered.map((r) => [r.id, r])).values()])
    const unordered = perSkill.map(({ skill, records }, i) => ({
      skill,
      count: records.length,
      form: recentForm(records),
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
      slides: heroAll.map(
        (record): Slide => ({
          record,
          media: cupOf(record),
          number: numbers.get(record.id) ?? 0,
          skillName: byId.get(record.skillId)?.name,
          first: withFirst && record.id === firstRecord.id,
        }),
      ),
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
      <Hero slides={data.slides} />

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

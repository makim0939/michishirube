import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { isLoggedIn } from '../data/account'
import { db } from '../data/db'
import { cupNumbers, practicingSkillIds, recordsOf } from '../data/repo'
import { getSyncConfig, getSyncStatus } from '../data/sync'
import { computeStates, indexById, practiceOrder, prereqsDone, sortByDepth } from '../domain/logic'
import type { Media, PracticeRecord, Skill } from '../domain/types'
import { recentForm, type RecentForm } from '../domain/form'
import { OUTCOME_MARK } from '../domain/format'
import { formatAgo, splitName } from './common'
import { pickCupMedia, useCupImage, useCupImageUrl, useImageUrl } from './cupImage'
import { hasCupImage } from '../data/poster'
import { FormDots } from './FormDots'
import { AlertIcon, CameraIcon } from './icons'
import { href } from './router'
import { readStorage, writeStorage } from './storage'
import { PatternImage } from './PatternImage'
import { recommendLabel } from './skillLabels'
import { LIGHT_LABEL, lightFor, lightUrl, type Light } from './world'
import { isNativeApp } from '../platform'

const HINT_KEY = 'michishirube:install-hint-dismissed'
/** メイン写真を探しにいく、新しい記録の数 */
const HERO_LOOKBACK = 20
/** 大きな写真でめくれる、最近の杯の数 */
const HERO_SLIDES = 6
/** 型ごとの最近の杯（横にスクロールして見る） */
const RECENT = 12
/** 次のおすすめは、数を絞って出す（全部は型の画面で） */
const RECOMMEND = 3

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
 * 気にしてほしいことを1行だけ出す。同期の失敗 → ホーム画面に追加（閉じられる）の順に大事。
 * ホーム画面に追加しないと Safari が記録を消すことがあるので、同期をつないでいなくても先に出す。
 * 「記録はこの端末だけ」という案内は、ログインしないで使う人には重いので出さない（設定の「アカウント」に書いてある）
 */
function Notice() {
  const [hintHidden, setHintHidden] = useState(() => readStorage('local', HINT_KEY) === '1')
  const data = useLiveQuery(async () => ({
    config: await getSyncConfig(),
    status: await getSyncStatus(),
    uploads: await db.media.where('upload').anyOf('pending', 'uploading').count(),
    failed: await db.media.where('upload').equals('failed').count(),
  }))
  if (!data) return null

  // Google でログインしていない端末（端末だけで使う人・前の版の接続）には、同期の失敗を出さない
  if (isLoggedIn(data.config) && data.status.error) {
    return (
      <a className="notice" href={href('/settings/sync')}>
        <AlertIcon size={18} />
        <span>同期できていません。設定を確かめてください</span>
      </a>
    )
  }
  // アプリ（ストアから入れたもの）では、ホーム画面に追加する必要はない
  if (!hintHidden && !isNativeApp && isIos() && !isStandalone()) {
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
  const url = useImageUrl(blob, slide.media ? `${slide.media.id}-hero-${blob?.size ?? 0}` : undefined)
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
        {/* 題字は、写真に馴染む欧文（ラテ帳の読み）に、小さく和文を添える */}
        <span className="wordmark" role="img" aria-label="ラテ帳">
          <span className="wordmark-latin" aria-hidden="true">
            Latte chō
          </span>
          <span className="wordmark-ja" aria-hidden="true">
            ラテ帳
          </span>
        </span>
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
  const url = useCupImageUrl(media, 'thumb')
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
  /** 最後に練習した日時（記録が無ければ練習中にした日時） */
  last: number
}

/** 練習中の型1つ分。次の一手・記録する・その型の最近の杯を、この型の中にまとめる */
function PracticeBlock({ practice }: { practice: Practice }) {
  const { skill, count, next, recent, form } = practice
  const { main, sub } = splitName(skill.name)
  return (
    <section className="practice-block" aria-label={main}>
      <a className="practice-head" href={href(`/skill/${skill.id}`)}>
        <PatternImage name={skill.name} />
        <span className="practice-title">
          <span className="practice-name">{main}</span>
          {sub && <span className="muted small">{sub}</span>}
          {/* 最近の調子（直近10杯）。文字を増やさず、点だけで */}
          <FormDots form={form} />
        </span>
        <span className="practice-count">
          <strong>{count}</strong>杯
        </span>
      </a>
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
    </section>
  )
}

/** ホームに出す内容を読み込む */
async function loadToday() {
  const [skills, practicing] = await Promise.all([db.skills.toArray(), practicingSkillIds()])
  const byId = indexById(skills)
  const states = computeStates(skills, practicing)
  // 練習中＝最近記録した型（「できた」の型も、続けて練習していれば出す）
  const active = skills.filter((s) => practicing.has(s.id))
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
    last: records[0]?.createdAt ?? 0,
  }))
  // 最近練習した型を上に（撮るときに、カードを探さずに済むように）
  const practices: Practice[] = practiceOrder(unordered, (p) => p.last)
  const thisWeek = await db.records.where('createdAt').aboveOrEqual(startOfWeek(Date.now())).count()
  // 次のおすすめ：前提ができている「次の一歩」を先に、前提を練習中のものを後に並べる
  const available = sortByDepth(skills.filter((s) => states.get(s.id) === 'available'))
    .map((s) => ({ ...s, parallel: !prereqsDone(s, byId), label: recommendLabel(s, byId, practicing) }))
    .sort((a, b) => Number(a.parallel) - Number(b.parallel))
    .slice(0, RECOMMEND)
  return {
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
}

/**
 * 前に出したホームの内容。ほかの画面（カメラなど）から戻ったとき、読み込みを待たずにすぐ出す
 * （待つあいだ、真っ白 → 枠だけ → 写真、と切り替わってちらつくため）。読み込めたら、新しい内容に替わる
 */
let lastToday: Awaited<ReturnType<typeof loadToday>> | undefined

/** 覚えているホームの内容を捨てる（「すべて削除」のとき。削除したはずの記録を、戻った瞬間に出さない） */
export function forgetToday() {
  lastToday = undefined
}

export function TodayScreen() {
  const data = useLiveQuery(
    async () => {
      lastToday = await loadToday()
      return lastToday
    },
    [],
    lastToday,
  )

  if (!data) return null

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
              </span>
            </div>
            <div className="practice-list">
              {data.practices.map((p) => (
                <PracticeBlock key={p.skill.id} practice={p} />
              ))}
            </div>
          </>
        ) : data.skillCount > 0 ? (
          <div className="sheet-empty">
            <h2>練習中の型</h2>
            {data.available.length > 0 ? (
              <p>下のおすすめか型の画面から、やってみたい型を記録すると、ここに出ます。</p>
            ) : (
              <>
                <p>型の画面から、やってみたい型を選んで記録すると、ここに出ます。</p>
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

        {data.available.length > 0 && (
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
                        {s.label}
                      </span>
                    </span>
                  </a>
                  {/* 押すとすぐカメラが開く（記録すると練習中になり、上に出る） */}
                  <a className="btn small" href={href(`/record/${s.id}`)}>
                    記録する
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

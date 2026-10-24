import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isLoggedIn } from '../data/account'
import { db } from '../data/db'
import { cupNumbers, practicingSkillIds, recordedSkillIds, recordsOf } from '../data/repo'
import { getSyncConfig, getSyncStatus } from '../data/sync'
import { uploadBacklog } from '../data/videoStorage'
import { isYoutubeConnected } from '../data/youtube'
import { computeStates, indexById, practiceOrder, prereqsDone, sortByDepth } from '../domain/logic'
import type { Media, PracticeRecord, Skill } from '../domain/types'
import { recentForm, type RecentForm } from '../domain/form'
import { OUTCOME_MARK } from '../domain/format'
import { formatAgo, splitName } from './common'
import { pickCupMedia, useContent, useCupImageUrl, useImageUrl } from './cupImage'
import { hasCupImage } from '../data/poster'
import { FormDots } from './FormDots'
import { AlertIcon, CameraIcon } from './icons'
import { href } from './router'
import { readStorage, writeStorage } from './storage'
import { PatternImage } from './PatternImage'
import { recommendLabel } from './skillLabels'
import { LIGHT_LABEL, lightFor, lightUrl, type Light } from './world'
import { isIosDevice, isNativeApp } from '../platform'
import { t } from '../i18n'

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

/**
 * 時刻から作る値を、定期的と、裏から戻ったときに読み直す（開いたままでも古いままにならないように）。
 * 読んだ値が前と同じなら（文字など）、画面は描き直さない
 */
function useClock<T>(read: () => T, intervalMs = 60_000): T {
  const [value, setValue] = useState(read)
  const latestRead = useRef(read)
  latestRead.current = read
  useEffect(() => {
    const tick = () => setValue(latestRead.current())
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
  return value
}

/** いまの時刻。開いたままや、裏から戻ったときにも、日付と光が古いままにならないようにする */
function useNow(): Date {
  return useClock(() => new Date())
}

/** 今日の日付（端末の時刻で）。開いたまま日付が変わったら、今週の杯数・練習中の型を数え直すために使う */
function useDayKey(): string {
  return useClock(() => new Date().toDateString())
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
    connected: await isYoutubeConnected(),
    // YouTube に上げる設定の端末だけ数える（端末に置く設定なら、上げないので待ちにならない）
    backlog: await uploadBacklog(),
  }))
  if (!data) return null

  // Google でログインしていない端末（端末だけで使う人・前の版の接続）には、同期の失敗を出さない
  if (isLoggedIn(data.config) && data.status.error) {
    return (
      <a className="notice" href={href('/settings/sync')}>
        <AlertIcon size={18} />
        <span>{t.today.syncFailed}</span>
      </a>
    )
  }
  // アプリ（ストアから入れたもの）では、ホーム画面に追加する必要はない
  if (!hintHidden && !isNativeApp && isIosDevice() && !isStandalone()) {
    return (
      <div className="notice">
        <AlertIcon size={18} />
        <span>{t.today.installHint}</span>
        <button
          className="notice-close"
          aria-label={t.common.close}
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
  if (data.backlog.failed > 0) {
    return (
      <p className="notice quiet">
        {t.today.uploadFailed(data.backlog.failed)}
      </p>
    )
  }
  if (data.backlog.waiting > 0) {
    // 連携していないと、待っていても上がらない。「開いている間に上げます」と言わず、何をすればよいかを伝える
    if (!data.connected) {
      return (
        <a className="notice" href={href('/settings/storage')}>
          <AlertIcon size={18} />
          <span>{t.today.notUploaded(data.backlog.waiting, isLoggedIn(data.config))}</span>
        </a>
      )
    }
    return (
      <p className="notice quiet">{t.today.waiting(data.backlog.waiting)}</p>
    )
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
function HeroSlide({
  slide,
  light,
  now,
  onMissing,
}: {
  slide: Slide
  light: Light
  now: Date
  /** 写真を読めなかったとき（電波が無く、サーバーにしか無い写真など）に知らせる */
  onMissing: (recordId: string) => void
}) {
  // 大きな写真には写真だけを使う（動画のコマは出さない）ので、中身そのものを読む
  const { blob, loading } = useContent(slide.media)
  const url = useImageUrl(blob, slide.media ? `${slide.media.id}-hero-${blob?.size ?? 0}` : undefined)
  const recordId = slide.record.id
  useEffect(() => {
    if (!loading && !blob) onMissing(recordId)
  }, [loading, blob, recordId, onMissing])
  const label = `No.${slide.number}${slide.skillName ? ` ${splitName(slide.skillName).main}` : ''}`
  return (
    <div className="hero-slide">
      <img className="hero-image" src={url ?? lightUrl(light)} alt={url ? label : ''} />
      {url && (
        <div className="hero-caption">
          {slide.first && <span className="hero-first">{t.today.firstCup}</span>}
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
 * 今日の画面のいちばん上。最近の杯の写真を左右にめくれて、最後の1枚は「はじめの1杯」（いまと見比べる）。
 * 写真がまだ無いあいだは、いまの時刻の光の絵を出す
 */
function Hero({ slides: all }: { slides: Slide[] }) {
  const now = useNow()
  // 写真を読めなかった杯は、時刻の光の絵のスライドが混ざらないよう、めくる列から外す
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  const onMissing = useCallback((id: string) => setMissing((m) => (m.has(id) ? m : new Set(m).add(id))), [])
  const slides = all.filter((s) => !missing.has(s.record.id))
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
    <section className="today-hero" aria-label={slides.length > 0 ? t.today.heroLabel : undefined}>
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
            <HeroSlide key={s.record.id} slide={s} light={light} now={now} onMissing={onMissing} />
          ))}
        </div>
      )}
      <div className="hero-shade" aria-hidden="true" />
      <div className="hero-top">
        {/* 題字は、写真に馴染む欧文（ラテ帳の読み）に、小さく和文を添える */}
        <h1 className="wordmark" aria-label={t.settings.appName}>
          <span className="wordmark-latin" aria-hidden="true">
            Latte chō
          </span>
          <span className="wordmark-ja" aria-hidden="true">
            ラテ帳
          </span>
        </h1>
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
  // 電波が無いなどで画像（YouTube のサムネイルなど）を読めなかったら、壊れた画像の印ではなく空の丸にする
  const [failedUrl, setFailedUrl] = useState<string>()
  const shown = url && url !== failedUrl ? url : undefined
  return (
    <li>
      {/* 押すと、その1杯の動画・写真と理由を見返せる */}
      <a className="recent-cup" href={href(`/cup/${record.id}`)} aria-label={t.today.cupDetail(`${name ? `${name} ` : ''}${label}`)}>
        {shown ? <img src={shown} alt="" onError={() => setFailedUrl(shown)} /> : <span className="recent-empty" aria-hidden="true" />}
        <span className="recent-no">
          {label}
          {record.outcome && ` ${OUTCOME_MARK[record.outcome]}`}
        </span>
        {/* ほかの型の杯は、どの型かが見えるように型の名前を添える */}
        {name && <span className="recent-skill">{name}</span>}
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
          {t.today.cupCount(count)}
        </span>
      </a>
      {/* 次の一手は、書いたことがあるときだけ出す（無いときの説明は記録画面にある） */}
      {next && (
        <p className="next-line">
          <span className="next-label">{t.record.nextAction}</span>
          <span className="next-text">{next}</span>
        </p>
      )}
      <a className="btn primary shoot" href={href(`/record/${skill.id}`)}>
        <CameraIcon size={20} />
        {/* 記録ボタンは、その型で何杯目か（杯の No. は全体の通し番号） */}
        {t.today.recordNth(count + 1)}
      </a>
      {recent.length > 0 && (
        <ul className="recent-cups" aria-label={t.today.recentOf(main)}>
          {recent.map((r) => (
            <RecentCup key={r.record.id} record={r.record} media={r.media} label={`No.${r.number}`} />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * いちばん古い、写真のある杯（「はじめの1杯」）。
 * 動画・写真の createdAt は入れた時刻で、あとから編集で足すと古い杯でも新しくなるので、記録の日時の古い順にたどる。
 * 杯の絵は今日の画面と同じく写真を先に選ぶ。ふつうは最初の数杯で見つかるので、少しずつ読む
 */
async function firstCupRecord(canFetch: boolean): Promise<PracticeRecord | undefined> {
  const PAGE = 50
  // offset で飛ばすと、そのぶん毎回たどり直すので、前の頁の最後の日時から続けて読む。
  // 同じミリ秒の記録が頁の境目にまたがると飛ぶことがあるが、記録は1件ずつ保存するので、まず起きない
  let last: number | undefined
  for (;;) {
    const records = await (last === undefined ? db.records.orderBy('createdAt') : db.records.where('createdAt').above(last))
      .limit(PAGE)
      .toArray()
    if (records.length === 0) return undefined
    last = records[records.length - 1].createdAt
    const media = await db.media.bulkGet([...new Set(records.flatMap((r) => r.mediaIds ?? []))])
    const byId = new Map(media.filter((m) => !!m).map((m) => [m.id, m]))
    const hit = records.find((r) => hasCupImage(pickCupMedia((r.mediaIds ?? []).map((id) => byId.get(id))), canFetch))
    if (hit) return hit
  }
}

/** ホームに出す内容を読み込む。now は、今週の杯数と練習中の型（最近の日数）を数える基準 */
async function loadToday(now: number) {
  const [skills, practicing, recorded] = await Promise.all([
    db.skills.toArray(),
    practicingSkillIds(now),
    recordedSkillIds(),
  ])
  const byId = indexById(skills)
  const states = computeStates(skills, practicing)
  // 練習中＝最近記録した型（「できた」の型も、続けて練習していれば出す）
  const active = skills.filter((s) => practicing.has(s.id))
  const perSkill = await Promise.all(active.map(async (skill) => ({ skill, records: await recordsOf(skill.id) })))
  // サーバーから写真を取ってこられるか（印が無くても、サーバーにある写真は候補にする）
  const canFetch = !!(await getSyncConfig())
  // 新しい記録から、大きな写真でめくる杯を選ぶ。最後に「はじめの1杯」（いちばん古い、写真のある杯）を置く
  const [latest, firstCandidate] = await Promise.all([
    db.records.orderBy('createdAt').reverse().limit(HERO_LOOKBACK).toArray(),
    firstCupRecord(canFetch),
  ])
  // 動画・写真は、大きな写真の候補と各型の最近の杯の分をまとめて1回で読む
  const recentOf = perSkill.map(({ records }) => records.slice(0, RECENT))
  const mediaIds = [...latest, ...(firstCandidate ? [firstCandidate] : []), ...recentOf.flat()].flatMap(
    (r) => r.mediaIds ?? [],
  )
  const media = await db.media.bulkGet([...new Set(mediaIds)])
  const mediaById = new Map(media.filter((m) => !!m).map((m) => [m.id, m]))
  const cupOf = (r: PracticeRecord) => pickCupMedia((r.mediaIds ?? []).map((id) => mediaById.get(id)))
  // 写真のある杯（動画のコマは、きれいにカップが写っているとは限らないので使わない）
  const heroRecords = latest.filter((r) => hasCupImage(cupOf(r), canFetch)).slice(0, HERO_SLIDES)
  const firstRecord = firstCandidate && hasCupImage(cupOf(firstCandidate), canFetch) ? firstCandidate : undefined
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
  const thisWeek = await db.records.where('createdAt').aboveOrEqual(startOfWeek(now)).count()
  // 次のおすすめ：前提ができている「次の一歩」を先に、前提を練習中のものを後に並べる
  const available = sortByDepth(skills.filter((s) => states.get(s.id) === 'available'))
    .map((s) => ({ ...s, parallel: !prereqsDone(s, byId), label: recommendLabel(s, recorded) }))
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
        // 最後の1枚が「はじめの1杯」。最近の杯の中にすでに入っていても、2枚以上めくれるときはラベルを付ける
        first: !!firstRecord && record.id === firstRecord.id && heroAll.length > 1,
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
  // 開いたまま日付が変わったら（月曜になった・21日を過ぎた）、数え直す
  const day = useDayKey()
  const data = useLiveQuery(
    async () => {
      lastToday = await loadToday(Date.now())
      return lastToday
    },
    [day],
    lastToday,
  )

  if (!data) return null

  // はじめて開いたときは、最初のおすすめを大きなボタンに出すので、下の一覧には重ねて出さない
  const firstRun = data.practices.length === 0 && data.skillCount > 0 && data.available.length > 0
  const recommended = firstRun ? data.available.slice(1) : data.available

  return (
    <div className="screen today">
      <Hero slides={data.slides} />

      <div className="today-sheet">
        <Notice />

        {data.practices.length > 0 ? (
          <>
            <div className="sheet-head">
              <h2>{t.today.practicing}</h2>
              <span className="muted small">
                {/* 週の初め（まだ0杯）は、数を出さない */}
                {data.thisWeek > 0 && <>{t.today.thisWeek(data.thisWeek)} · </>}
                <a href={href('/records')}>{t.app.tabRecords}</a>
              </span>
            </div>
            <div className="practice-list">
              {data.practices.map((p) => (
                <PracticeBlock key={p.skill.id} practice={p} />
              ))}
            </div>
          </>
        ) : data.skillCount > 0 ? (
          data.available.length > 0 ? (
            // はじめて開いたとき：最初の1杯へ、迷わず進めるボタンを1つだけ出す
            <div className="sheet-empty first-run">
              <h2>{t.today.firstRun}</h2>
              <a className="btn primary shoot" href={href(`/record/${data.available[0].id}`)}>
                <CameraIcon size={20} />
                {t.today.recordSkill(splitName(data.available[0].name).main)}
              </a>
              {/* 下に「次のおすすめ」が出るときは、そちらに同じリンクがある */}
              {recommended.length === 0 && (
                <a className="sub-link" href={href('/map')}>
                  {t.today.chooseOther}
                </a>
              )}
            </div>
          ) : (
            <div className="sheet-empty">
              <h2>{t.today.practicing}</h2>
              <a className="btn" href={href('/map')}>
                {t.today.chooseSkill}
              </a>
            </div>
          )
        ) : (
          <div className="sheet-empty">
            <p>{t.today.noSkills}</p>
            <a className="btn primary" href={href('/map')}>
              {t.today.prepareSkills}
            </a>
          </div>
        )}

        {data.others.length > 0 && (
          <section className="section">
            <h2>{t.today.othersRecent}</h2>
            <ul className="recent-cups">
              {data.others.map((o) => (
                <RecentCup key={o.record.id} record={o.record} media={o.media} label={`No.${o.number}`} name={o.name} />
              ))}
            </ul>
          </section>
        )}

        {recommended.length > 0 && (
          <section className="section">
            <div className="sheet-head">
              <h2>{t.state.available}</h2>
              <a className="small" href={href('/map')}>
                {t.today.chooseOther}
              </a>
            </div>
            <ul className="type-rows">
              {recommended.map((s) => (
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
                    {t.common.record}
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

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { shareFileNative } from '../data/files'
import { isAndroidApp } from '../platform'
import { daysBetween } from '../domain/format'
import type { Media, SkillState } from '../domain/types'
import { PlayIcon } from './icons'
import { formatDate } from '../domain/format'
import { t } from '../i18n'

export const STATE_LABEL: Record<SkillState, string> = t.state

/** 「ミルクのスチーム（マイクロフォーム）」→ 大きく出す名前と、小さく添える補足 */
export function splitName(name: string): { main: string; sub?: string } {
  const m = name.match(/^(.+?)[（(](.+)[）)]$/)
  if (!m) return { main: name }
  // 「チューリップ（2段）」のような短い区別は、名前の一部として残す
  if (m[2].length <= 2) return { main: `${m[1]} ${m[2]}` }
  return { main: m[1], sub: m[2] }
}

export function StateBadge({ state }: { state: SkillState }) {
  return <span className={`badge state-${state}`}>{STATE_LABEL[state]}</span>
}

/**
 * 今日から何日前か（今日は 0）。
 * 時間の差を24時間で割ると、夏時間の切り替わる日（23時間・25時間の日）をまたいだときにずれるので、暦の日付で数える
 */
function daysAgo(ts: number, now: number): number {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  return ts >= startOfToday ? 0 : daysBetween(ts, now)
}

export function formatAgo(ts: number, now = Date.now()): string {
  const days = daysAgo(ts, now)
  if (days === 0) return t.common.today
  if (days === 1) return t.common.yesterday
  if (days < 30) return t.common.daysAgo(days)
  return formatDate(ts)
}

/**
 * 動画・写真を、記録の日時の古い順に並べる（同じ記録の中は、入れた順）。
 * 動画・写真の createdAt は入れた時刻なので、あとから編集で足すと、古い杯のものでも新しく見えてしまう。
 * 「最新と最初」は杯の新しさで決めたいので、記録の日時で並べる（記録が見つからないものは、入れた時刻で代える）
 */
export function sortByRecordDate(media: Media[], recordDate: (recordId: string) => number | undefined): Media[] {
  const at = (m: Media) => recordDate(m.recordId) ?? m.createdAt
  return [...media].sort((a, b) => at(a) - at(b) || a.createdAt - b.createdAt)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/**
 * Blob の表示用 URL。IndexedDB から読み直すたびに中身が同じでも別の Blob が返るので、
 * cacheKey（メディアの id）を渡すと、同じ id の間は URL を作り直さない（再生中の動画が止まらない）
 */
export function useObjectUrl(blob: Blob | undefined, cacheKey?: string): string | undefined {
  const [url, setUrl] = useState<string>()
  const latest = useRef(blob)
  latest.current = blob
  const dep = cacheKey ?? blob
  useEffect(() => {
    const b = latest.current
    if (!b) return
    const u = URL.createObjectURL(b)
    setUrl(u)
    return () => {
      URL.revokeObjectURL(u)
      setUrl(undefined)
    }
  }, [dep])
  return url
}

export function isVideo(m: Pick<Media, 'type'>) {
  return m.type.startsWith('video/')
}

/**
 * 動画は、押されたときにメモリへ写してから再生する。
 * iPhone の Safari は IndexedDB に置いた動画をそのまま再生できないことがあり、
 * 一覧で全部を読み込むとメモリも食うため。押す前はサムネイル（poster）を出す
 */
function VideoView({
  blob,
  type,
  poster,
  cacheKey,
  autoLoad,
  className,
  videoRef,
}: {
  blob: Blob
  type: string
  poster?: Blob
  cacheKey?: string
  autoLoad: boolean
  className?: string
  videoRef?: (el: HTMLVideoElement | null) => void
}) {
  const [requested, setRequested] = useState(autoLoad)
  const [playOnLoad, setPlayOnLoad] = useState(false)
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)
  const videoEl = useRef<HTMLVideoElement | null>(null)
  const posterUrl = useObjectUrl(poster, poster && cacheKey ? `${cacheKey}-poster-${poster.size}` : undefined)
  const latest = useRef(blob)
  latest.current = blob

  useEffect(() => {
    if (!requested) return
    let cancelled = false
    let u: string | undefined
    latest.current
      .arrayBuffer()
      .then((buf) => {
        if (cancelled) return
        u = URL.createObjectURL(new Blob([buf], { type }))
        setUrl(u)
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      if (u) URL.revokeObjectURL(u)
    }
  }, [requested, type])

  // 読み込めたらすぐ再生する。押してからの読み込みの間に音つきの自動再生が許されなくなっていたら（iPhone）、
  // 音なしで始める（音はプレーヤーで出せる）
  useEffect(() => {
    const el = videoEl.current
    if (!url || !el || !playOnLoad) return
    setPlayOnLoad(false)
    el.play().catch(() => {
      el.muted = true
      el.play().catch(() => {
        // それでも止められたら、プレーヤーの再生ボタンで再生してもらう
      })
    })
  }, [url, playOnLoad])

  if (failed) {
    return <div className={`media placeholder ${className ?? ''}`}>{t.common.videoLoadFailed}</div>
  }
  if (!url) {
    return (
      <button
        type="button"
        className={`media video-thumb ${className ?? ''}`}
        style={posterUrl ? { backgroundImage: `url(${posterUrl})` } : undefined}
        aria-label={t.common.playVideo}
        onClick={() => {
          setPlayOnLoad(true)
          setRequested(true)
        }}
      >
        <span aria-hidden="true">{requested ? '…' : <PlayIcon size={44} />}</span>
      </button>
    )
  }
  return (
    <video
      ref={(el) => {
        videoEl.current = el
        videoRef?.(el)
      }}
      className={`media playing ${className ?? ''}`}
      src={url}
      poster={posterUrl}
      controls
      playsInline
      preload="metadata"
    />
  )
}

/** 見比べで、2本を同時に動かすための操作（端末の動画と YouTube の動画のどちらにも使う） */
export interface PlayerControl {
  playMutedFromStart(): void
}

export function videoControl(v: HTMLVideoElement): PlayerControl {
  return {
    playMutedFromStart: () => {
      // iPhone は音の出る動画を1本しか同時に再生できず、後から再生した方だけが動くので、音を消して並べて再生する
      v.muted = true
      // 止めたら音を戻す（そのあと1本だけ再生したときに音が出るように）
      v.addEventListener('pause', () => (v.muted = false), { once: true })
      v.currentTime = 0
      v.play().catch(() => {
        // 自動再生が止められた場合は、各動画の再生ボタンで再生してもらう
      })
    },
  }
}

export function MediaView({
  blob,
  type,
  poster,
  cacheKey,
  autoLoad = false,
  className,
  videoRef,
}: {
  blob: Blob
  type: string
  poster?: Blob
  cacheKey?: string
  /** 動画をすぐ読み込む（比べるとき・撮った直後のプレビュー） */
  autoLoad?: boolean
  className?: string
  videoRef?: (el: HTMLVideoElement | null) => void
}) {
  if (type.startsWith('video/')) {
    return (
      <VideoView
        key={cacheKey}
        blob={blob}
        type={type}
        poster={poster}
        cacheKey={cacheKey}
        autoLoad={autoLoad}
        className={className}
        videoRef={videoRef}
      />
    )
  }
  return <ImageView blob={blob} cacheKey={cacheKey} className={className} />
}

function ImageView({ blob, cacheKey, className }: { blob: Blob; cacheKey?: string; className?: string }) {
  const url = useObjectUrl(blob, cacheKey)
  if (!url) return <div className={`media ${className ?? ''}`} />
  return <img className={`media ${className ?? ''}`} src={url} alt="" />
}

/** 押すと確認に切り替わるボタン。ダイアログを使わずにその場で確認する */
export function ConfirmButton({
  children,
  confirmLabel,
  message,
  onConfirm,
  className = 'btn',
}: {
  children: ReactNode
  confirmLabel: string
  message?: ReactNode
  onConfirm: () => void | Promise<void>
  className?: string
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {children}
      </button>
    )
  }
  return (
    <div className="confirm">
      {message && <div className="confirm-message">{message}</div>}
      <div className="row">
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm()
            } finally {
              setBusy(false)
              setAsking(false)
            }
          }}
        >
          {confirmLabel}
        </button>
        <button type="button" className="btn ghost" onClick={() => setAsking(false)}>
          {t.common.cancel}
        </button>
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

/** 端末に保存する。スマホでは共有シート（「ファイルに保存」）、PC ではダウンロード */
export async function saveFile(blob: Blob, fileName: string) {
  const file = new File([blob], fileName, { type: blob.type })
  // Android のアプリは、Web の共有・ダウンロードが効かないので、共有シートで渡す
  if (isAndroidApp) {
    await shareFileNative(file)
    return
  }
  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** ブラウザに「容量が足りなくなっても消さないで」と頼む */
export async function requestPersist(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

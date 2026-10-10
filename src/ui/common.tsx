import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatDateTime } from '../domain/format'
import type { Media, SkillState } from '../domain/types'

export const STATE_LABEL: Record<SkillState, string> = {
  locked: 'ロック中',
  available: '挑戦できる',
  active: '挑戦中',
  done: '達成',
}

export const STATE_ICON: Record<SkillState, string> = {
  locked: '🔒',
  available: '✨',
  active: '🔥',
  done: '🏆',
}

export function StateBadge({ state }: { state: SkillState }) {
  return (
    <span className={`badge state-${state}`}>
      <span aria-hidden="true">{STATE_ICON[state]}</span> {STATE_LABEL[state]}
    </span>
  )
}

const DAY = 24 * 60 * 60 * 1000

export const formatDate = formatDateTime

export function formatAgo(ts: number, now = Date.now()): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (ts >= startOfToday) return '今日'
  const days = Math.ceil((startOfToday - ts) / DAY)
  if (days === 1) return '昨日'
  if (days < 30) return `${days}日前`
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
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

  if (failed) {
    return <div className={`media placeholder ${className ?? ''}`}>動画を読み込めませんでした</div>
  }
  if (!url) {
    return (
      <button
        type="button"
        className={`media video-thumb ${className ?? ''}`}
        style={posterUrl ? { backgroundImage: `url(${posterUrl})` } : undefined}
        aria-label="動画を再生"
        onClick={() => {
          setPlayOnLoad(true)
          setRequested(true)
        }}
      >
        <span aria-hidden="true">{requested ? '…' : '▶'}</span>
      </button>
    )
  }
  return (
    <video
      ref={videoRef}
      className={`media ${className ?? ''}`}
      src={url}
      poster={posterUrl}
      controls
      playsInline
      preload="metadata"
      autoPlay={playOnLoad}
    />
  )
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
        <button type="button" className="btn" onClick={() => setAsking(false)}>
          やめる
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

import { useEffect, useRef, useState } from 'react'
import {
  CAMERA_CONSTRAINTS,
  extensionFor,
  MAX_RECORDING_MS,
  pickRecorderMimeType,
  RECORDER_BITRATE,
} from '../data/mediaPrep'
import { readStorage, writeStorage } from './storage'
import { MicIcon } from './icons'

const AUDIO_KEY = 'michishirube:recorder-audio'

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function canRecordInApp(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t))
  )
}

/**
 * 画面の枠（object-fit: cover で映したプレビューの上）が、カメラの元の映像のどこに当たるか。
 * 枠が無ければ、映像の中央の正方形
 */
function guideToSource(video: HTMLVideoElement, guide: HTMLElement | null) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const fallback = { sx: (vw - Math.min(vw, vh)) / 2, sy: (vh - Math.min(vw, vh)) / 2, side: Math.min(vw, vh) }
  if (!guide) return fallback
  const el = video.getBoundingClientRect()
  const g = guide.getBoundingClientRect()
  const scale = Math.max(el.width / vw, el.height / vh)
  if (!scale) return fallback
  const offsetX = (el.width - vw * scale) / 2
  const offsetY = (el.height - vh * scale) / 2
  const side = Math.min(g.width / scale, vw, vh)
  const sx = Math.min(Math.max(0, (g.left - el.left - offsetX) / scale), vw - side)
  const sy = Math.min(Math.max(0, (g.top - el.top - offsetY) / scale), vh - side)
  return { sx, sy, side }
}

/**
 * アプリの中で、画質を抑えて録画する（スマホ標準のカメラより数分の1の大きさ）。
 * 使えないときや許可されなかったときは、onFallback で標準のカメラに切り替える
 */
export function Recorder({
  onDone,
  onClose,
  onFallback,
}: {
  /** photo は、録画のあとに撮った「できあがり」の写真（スキップしたら無い） */
  onDone: (file: File, photo?: File) => void
  onClose: () => void
  onFallback: () => void
}) {
  const preview = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const [audio, setAudio] = useState(() => readStorage('local', AUDIO_KEY) !== 'off')
  const [error, setError] = useState<string>()
  const [ready, setReady] = useState(false)
  const [startedAt, setStartedAt] = useState<number>()
  const [now, setNow] = useState(Date.now())
  /** 録画を止めたあと、できあがりの写真を待っている動画 */
  const [finished, setFinished] = useState<File>()
  const [shooting, setShooting] = useState(false)
  const guide = useRef<HTMLDivElement>(null)

  // カメラを開く（音の有無を切り替えたら開き直す）
  useEffect(() => {
    let cancelled = false
    setReady(false)
    navigator.mediaDevices
      .getUserMedia({ video: CAMERA_CONSTRAINTS, audio })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = s
        if (preview.current) preview.current.srcObject = s
        setReady(true)
      })
      .catch((e: unknown) => {
        const denied = e instanceof DOMException && e.name === 'NotAllowedError'
        setError(
          denied
            ? 'カメラ（またはマイク）の使用が許可されていません。設定で許可するか、標準のカメラを使ってください。'
            : 'カメラを開けませんでした。標準のカメラを使ってください。',
        )
      })
    return () => {
      cancelled = true
      recorder.current?.state === 'recording' && recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
    }
  }, [audio])

  // できあがりを撮る画面に切り替えたら、開いているカメラをそのまま映す
  useEffect(() => {
    if (finished && preview.current && stream.current) preview.current.srcObject = stream.current
  }, [finished])

  // 録画中の経過時間と、上限での自動停止
  useEffect(() => {
    if (startedAt === undefined) return
    const timer = setInterval(() => {
      setNow(Date.now())
      if (Date.now() - startedAt >= MAX_RECORDING_MS) recorder.current?.stop()
    }, 250)
    return () => clearInterval(timer)
  }, [startedAt])

  const start = () => {
    const s = stream.current
    const mimeType = pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t), audio)
    if (!s || !mimeType) return
    const chunks: Blob[] = []
    let r: MediaRecorder
    try {
      r = new MediaRecorder(s, {
        mimeType,
        videoBitsPerSecond: RECORDER_BITRATE.video,
        ...(audio ? { audioBitsPerSecond: RECORDER_BITRATE.audio } : {}),
      })
    } catch {
      setError('この端末では録画を始められませんでした。標準のカメラを使ってください。')
      return
    }
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    r.onstop = () => {
      setStartedAt(undefined)
      const type = r.mimeType || mimeType
      const blob = new Blob(chunks, { type: type.split(';')[0] })
      if (blob.size === 0) {
        setError('録画できませんでした。もう一度試すか、標準のカメラを使ってください。')
        return
      }
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
      // 動画の最後に、きれいにカップが写っているとは限らないので、続けてできあがりを1枚撮ってもらう
      setFinished(new File([blob], `rec-${stamp}.${extensionFor(type)}`, { type: blob.type }))
    }
    recorder.current = r
    try {
      r.start(1000)
    } catch {
      setError('この端末では録画を始められませんでした。標準のカメラを使ってください。')
      return
    }
    setStartedAt(Date.now())
    setNow(Date.now())
  }

  const recording = startedAt !== undefined

  /** いま映っているコマから、枠の中を写真にする（開いているカメラのまま、1回押すだけ） */
  const shoot = async () => {
    const video = preview.current
    // 2回押しても、二重に記録に入れない
    if (!finished || shooting) return
    setShooting(true)
    let photo: File | undefined
    if (video && video.videoWidth && video.videoHeight) {
      const { sx, sy, side } = guideToSource(video, guide.current)
      const size = Math.round(Math.min(side, 1600))
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      canvas.getContext('2d')!.drawImage(video, sx, sy, side, side, 0, 0, size, size)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      if (blob) photo = new File([blob], finished.name.replace(/\.[^.]+$/, '') + '-cup.jpg', { type: 'image/jpeg' })
    }
    onDone(finished, photo)
  }

  if (finished) {
    return (
      <div className="recorder" role="dialog" aria-modal="true" aria-label="できあがりを撮る">
        <video ref={preview} className="recorder-preview" autoPlay playsInline muted />
        <div className="finish-guide" ref={guide} aria-hidden="true" />
        <p className="finish-hint">できあがりのカップを、枠の中に入れて1枚</p>
        <div className="recorder-bottom">
          <button
            className="shutter-button"
            aria-label="できあがりを撮る"
            disabled={shooting}
            onClick={() => void shoot()}
          />
          <button className="btn small ghost recorder-native" disabled={shooting} onClick={() => onDone(finished)}>
            スキップ
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="recorder" role="dialog" aria-modal="true" aria-label="録画">
      <video ref={preview} className="recorder-preview" autoPlay playsInline muted />
      {!ready && !error && <p className="recorder-status">カメラを準備しています…</p>}
      {error && (
        <div className="recorder-error">
          <p>{error}</p>
          <button className="btn primary" onClick={onFallback}>
            標準のカメラで撮る
          </button>
        </div>
      )}
      <div className="recorder-top">
        <button className="btn small" onClick={onClose} disabled={recording}>
          閉じる
        </button>
        {recording ? (
          <span className="recorder-time">● {formatElapsed(now - startedAt)}</span>
        ) : (
          <button
            className="btn small"
            disabled={!ready}
            onClick={() => {
              writeStorage('local', AUDIO_KEY, audio ? 'off' : 'on')
              setAudio(!audio)
            }}
          >
            <MicIcon size={18} off={!audio} />
            {audio ? '音あり' : '音なし'}
          </button>
        )}
      </div>
      <div className="recorder-bottom">
        <button
          className={`record-button ${recording ? 'recording' : ''}`}
          disabled={!ready}
          aria-label={recording ? '録画を止める' : '録画を始める'}
          onClick={() => (recording ? recorder.current?.stop() : start())}
        />
        {!recording && !error && (
          <button className="btn small ghost recorder-native" onClick={onFallback}>
            標準のカメラ
          </button>
        )}
      </div>
    </div>
  )
}

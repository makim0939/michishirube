import { useEffect, useRef, useState } from 'react'
import {
  cameraConstraints,
  extensionFor,
  judgeRecording,
  MAX_RECORDING_MS,
  markRecorderTypeBroken,
  pickRecorderMimeType,
  QUALITY,
  recorderSupports,
} from '../data/mediaPrep'
import type { VideoQuality } from '../data/videoStorage'
import { isWebUrl } from '../domain/template'
import type { Reference } from '../domain/types'
import { readStorage, writeStorage } from './storage'
import { MicIcon, PhotoIcon } from './icons'

const AUDIO_KEY = 'michishirube:recorder-audio'
const MODE_KEY = 'michishirube:recorder-mode'

type Mode = 'video' | 'photo'

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function canRecordInApp(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!pickRecorderMimeType(recorderSupports)
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
 * アプリの中のカメラ。注ぐところを画質を抑えて録画し（スマホ標準のカメラより数分の1の大きさ）、続けてできあがりを1枚撮る。
 * 写真だけにもでき、アルバムからも選べる。注ぐ前に見たい「今回意識すること」と手本の動画を、カメラの上に出す。
 * 使えないときや許可されなかったときは、onFallback で標準のカメラに切り替える
 */
export function Recorder({
  onDone,
  onClose,
  onFallback,
  onAlbum,
  focus,
  references = [],
  quality: defaultQuality,
}: {
  /** video は録画（写真だけのときは無い）、photo はできあがりの写真（スキップしたら無い）。quality は、この動画を撮った画質 */
  onDone: (video: File | undefined, photo: File | undefined, quality: VideoQuality) => void
  onClose: () => void
  /** 標準のカメラに切り替える（いま選んでいる動画・写真で開く） */
  onFallback: (mode: Mode) => void
  /** アルバムから選ぶ */
  onAlbum?: () => void
  /** 今回意識すること（前回の次の一手） */
  focus?: string
  /** 手本の動画・記事 */
  references?: Reference[]
  /** 撮る画質の初めの値（設定の「画質」）。上の「画質」のボタンで、この1回だけ変えられる */
  quality: VideoQuality
}) {
  const [quality, setQuality] = useState(defaultQuality)
  const preview = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  /** 押して（または上限で）止めたか。録画が勝手に止まったら、この形式では撮れない合図 */
  const stoppedByUser = useRef(false)
  const [audio, setAudio] = useState(() => readStorage('local', AUDIO_KEY) !== 'off')
  const [mode, setMode] = useState<Mode>(() => (readStorage('local', MODE_KEY) === 'photo' ? 'photo' : 'video'))
  const [showRefs, setShowRefs] = useState(false)
  const [error, setError] = useState<string>()
  /** 止めずに知らせること（もう一度撮れば撮れるとき） */
  const [notice, setNotice] = useState<string>()
  const [ready, setReady] = useState(false)
  const [startedAt, setStartedAt] = useState<number>()
  const [now, setNow] = useState(Date.now())
  /** 録画を止めたあと、できあがりの写真を待っている動画 */
  const [finished, setFinished] = useState<File>()
  const [shooting, setShooting] = useState(false)
  const guide = useRef<HTMLDivElement>(null)

  // 写真だけのときは、マイクを使わない
  const withAudio = audio && mode === 'video'

  // カメラを開く（音の有無・動画と写真を切り替えたら開き直す）
  useEffect(() => {
    let cancelled = false
    setReady(false)
    navigator.mediaDevices
      .getUserMedia({ video: cameraConstraints(quality), audio: withAudio })
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
      stoppedByUser.current = true
      recorder.current?.state === 'recording' && recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
    }
  }, [withAudio, quality])

  // できあがりを撮る画面に切り替えたら、開いているカメラをそのまま映す
  useEffect(() => {
    if (finished && preview.current && stream.current) preview.current.srcObject = stream.current
  }, [finished])

  // 録画中の経過時間と、上限での自動停止
  useEffect(() => {
    if (startedAt === undefined) return
    const timer = setInterval(() => {
      setNow(Date.now())
      if (Date.now() - startedAt >= MAX_RECORDING_MS) stopRecording()
    }, 250)
    return () => clearInterval(timer)
  }, [startedAt])

  const stopRecording = () => {
    stoppedByUser.current = true
    recorder.current?.stop()
  }

  const start = () => {
    stoppedByUser.current = false
    const s = stream.current
    setNotice(undefined)
    const mimeType = pickRecorderMimeType(recorderSupports, audio, quality)
    if (!s || !mimeType) return
    const chunks: Blob[] = []
    const began = Date.now()
    let r: MediaRecorder
    try {
      r = new MediaRecorder(s, {
        mimeType,
        videoBitsPerSecond: QUALITY[quality].video,
        ...(audio ? { audioBitsPerSecond: QUALITY[quality].audio } : {}),
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
      const verdict = judgeRecording(blob.size, Date.now() - began, stoppedByUser.current)
      if (verdict === 'too-short') {
        // 押してすぐ止めたなど、短すぎる録画が空なのは、形式のせいではない（もう一度撮れば撮れる）
        setNotice('短すぎて録画できませんでした。もう一度撮ってください')
        return
      }
      if (verdict === 'broken') {
        // この形式はこの端末では撮れない。ほかの形式があれば、次からそちらで撮る
        const container = mimeType.split(';')[0]
        const others = !!pickRecorderMimeType((t) => recorderSupports(t) && !t.startsWith(container), audio, quality)
        if (others) {
          markRecorderTypeBroken(mimeType)
          setNotice('この端末に合う録画の形式に切り替えました。もう一度撮ってください')
        } else {
          setError('録画できませんでした。もう一度試すか、標準のカメラを使ってください。')
        }
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
    // 2回押しても、二重に記録に入れない（写真だけのときは、録画が無くても撮れる）
    if ((!finished && mode !== 'photo') || shooting) return
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
      const base = finished ? finished.name.replace(/\.[^.]+$/, '') : `photo-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`
      if (blob) photo = new File([blob], `${base}-cup.jpg`, { type: 'image/jpeg' })
    }
    if (!finished && !photo) {
      setShooting(false)
      return
    }
    onDone(finished, photo, quality)
  }

  const switchMode = (next: Mode) => {
    writeStorage('local', MODE_KEY, next)
    setMode(next)
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
          <button className="btn small ghost recorder-native" disabled={shooting} onClick={() => onDone(finished, undefined, quality)}>
            スキップ
          </button>
        </div>
      </div>
    )
  }

  const photoMode = mode === 'photo'

  return (
    <div className="recorder" role="dialog" aria-modal="true" aria-label={photoMode ? '写真を撮る' : '録画'}>
      <video ref={preview} className="recorder-preview" autoPlay playsInline muted />
      {/* 写真だけのときは、できあがりと同じ枠の中を撮る */}
      {photoMode && <div className="finish-guide" ref={guide} aria-hidden="true" />}
      {!ready && !error && <p className="recorder-status">カメラを準備しています…</p>}
      {ready && !error && notice && (
        <p className="recorder-status" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className="recorder-error">
          <p>{error}</p>
          <button className="btn primary" onClick={() => onFallback(mode)}>
            標準のカメラで撮る
          </button>
        </div>
      )}
      <div className="recorder-top">
        <div className="recorder-top-row">
          <button className="btn small" onClick={onClose} disabled={recording}>
            閉じる
          </button>
          {recording ? (
            <span className="recorder-time">● {formatElapsed(now - startedAt)}</span>
          ) : (
            // 撮り方の設定。音と画質は、ほかのボタン（手本）と分けて、右上にまとめる。写真のときは、どちらも使わない
            !photoMode && (
              <div className="row">
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
                {/* 画質は、選べるものを両方見せる（撮り直すと、設定の画質に戻る） */}
                <div className="recorder-modes small" role="radiogroup" aria-label="画質">
                  {(['standard', 'high'] as const).map((q) => (
                    <button
                      key={q}
                      type="button"
                      role="radio"
                      aria-checked={quality === q}
                      className={quality === q ? 'selected' : ''}
                      disabled={!ready}
                      onClick={() => setQuality(q)}
                    >
                      {QUALITY[q].shortSide}p
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
        {/* 注ぐ直前に見たい、今回意識すること。手本のボタンは、今回の有無や長さで動かないよう、いつも左端に置く */}
        {(focus || (references.length > 0 && !recording)) && (
          <div className="recorder-sub">
            {references.length > 0 && !recording && (
              <button className={`btn small${showRefs ? ' on' : ''}`} onClick={() => setShowRefs(!showRefs)}>
                手本
              </button>
            )}
            {focus && (
              <p className="recorder-focus">
                <span>今回</span>
                {focus}
              </p>
            )}
          </div>
        )}
        {showRefs && !recording && (
          <ul className="recorder-refs">
            {references.map((r) => (
              <li key={r.id}>
                {isWebUrl(r.url) ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    {r.title}
                  </a>
                ) : (
                  <span>{r.title}</span>
                )}
                {r.note && <small>{r.note}</small>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="recorder-bottom">
        {/* 動画と写真の切り替え（iPhone のカメラと同じく、シャッターの上に） */}
        {!recording && !error && (
          <div className="recorder-modes" role="radiogroup" aria-label="撮るもの">
            {(['video', 'photo'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={mode === m ? 'selected' : ''}
                onClick={() => switchMode(m)}
              >
                {m === 'video' ? '動画' : '写真'}
              </button>
            ))}
          </div>
        )}
        <div className="recorder-controls">
          {!recording && onAlbum ? (
            <button type="button" className="recorder-side" aria-label="アルバムから選ぶ" onClick={onAlbum}>
              <PhotoIcon size={24} />
            </button>
          ) : (
            <span className="recorder-side" aria-hidden="true" />
          )}
          {photoMode ? (
            <button
              className="shutter-button"
              aria-label="写真を撮る"
              disabled={!ready || shooting}
              onClick={() => void shoot()}
            />
          ) : (
            <button
              className={`record-button ${recording ? 'recording' : ''}`}
              disabled={!ready}
              aria-label={recording ? '録画を止める' : '録画を始める'}
              onClick={() => (recording ? stopRecording() : start())}
            />
          )}
          {!recording && !error ? (
            <button type="button" className="recorder-side text" onClick={() => onFallback(mode)}>
              標準の
              <br />
              カメラ
            </button>
          ) : (
            <span className="recorder-side" aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  )
}

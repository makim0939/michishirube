import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { inMemory, probeDuration } from '../data/mediaPrep'
import { clampRange, startTrim, waitUntilSeekable, type TrimJob, type TrimRange } from '../data/trim'
import { traceVideo } from '../debug'
import { PauseIcon, PlayIcon, SpeakerIcon } from './icons'
import { useBackHandler } from './useBackHandler'
import { t } from '../i18n'

/** フィルムの1コマあたりの数（写真アプリのように、横いっぱいに並べる） */
const FRAMES = 9
/** 範囲の最短 */
const MIN_LENGTH = 0.3

function formatTime(sec: number) {
  const s = Math.max(0, sec)
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

/** 動画から、フィルムに並べる小さなコマを作る（別の video で順に移動して描く）。isCancelled が true になったら止める */
async function makeFilmstrip(
  url: string,
  duration: number,
  count: number,
  isCancelled: () => boolean,
): Promise<string[]> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    // iPhone はデータを読み込ませるため、一度だけ音なしで再生して止める
    await video.play().catch(() => {})
    video.pause()
    const height = 72
    const frames: string[] = []
    for (let i = 0; i < count; i++) {
      // 編集を閉じたら、残りのコマは作らない（裏で動画を読み続けないように）
      if (isCancelled()) break
      const t = Math.min(duration - 0.05, ((i + 0.5) / count) * duration)
      video.currentTime = t
      await waitUntilSeekable(video, t, 3000)
      const canvas = document.createElement('canvas')
      canvas.height = height
      canvas.width = Math.round((height * (video.videoWidth || 9)) / (video.videoHeight || 16))
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push(canvas.toDataURL('image/jpeg', 0.6))
    }
    return frames
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}

/**
 * 動画の編集（iPhone の写真アプリのように）。フィルムの両端の取っ手を動かして範囲を決め、音のあり・なしを切り替える。
 * 「完了」で、選んだ範囲を再生しながら作り直す
 */
export function Trimmer({
  file,
  name,
  onDone,
  onClose,
}: {
  file: Blob
  name: string
  onDone: (file: File) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const audio = useRef<AudioContext | null>(null)
  const job = useRef<TrimJob | null>(null)
  const playUntil = useRef<number | null>(null)
  const interrupted = useRef(false)
  const dragging = useRef<'start' | 'end' | 'head' | null>(null)
  const [url, setUrl] = useState<string>()
  const [duration, setDuration] = useState(0)
  const [frames, setFrames] = useState<string[]>([])
  const [range, setRange] = useState<TrimRange>({ start: 0, end: 0 })
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string>()

  // Android の「戻る」は、「キャンセル」と同じ（記録の入力画面まで戻らない）。作り直している間は、その中止（画面の「キャンセル」と同じ）
  useBackHandler(() => {
    if (processing) job.current?.cancel()
    else onClose()
    return true
  })

  // メモリに写してから再生する（iPhone で IndexedDB の動画を直接再生できないことがあるため）
  useEffect(() => {
    let revoked = false
    let u: string | undefined
    inMemory(file)
      .then((b) => {
        if (revoked) return
        u = URL.createObjectURL(b)
        setUrl(u)
      })
      .catch(() => setError(t.common.videoLoadFailed))
    return () => {
      revoked = true
      if (u) URL.revokeObjectURL(u)
      job.current?.cancel()
      void audio.current?.close()
    }
  }, [file])

  useEffect(() => {
    const v = video.current
    if (!v || !url) return
    const untrace = traceVideo(v, 'editor')
    let cancelled = false
    probeDuration(v)
      .then(async (d) => {
        if (!d) throw new Error('no duration')
        setDuration(d)
        setRange({ start: 0, end: d })
        // iPhone はタップするまで動画のデータを読み込まず、コマが表示されない。音なしで一度再生して止める
        v.muted = true
        await v.play().catch(() => {})
        v.pause()
        v.currentTime = 0
        const film = await makeFilmstrip(url, d, FRAMES, () => cancelled).catch(() => [])
        if (!cancelled) setFrames(film)
      })
      .catch(() => setError(t.editor.durationFailed))
    return () => {
      cancelled = true
      untrace()
    }
  }, [url])

  // 作り直しの途中で別のアプリに切り替えると止まるので、中断して知らせる
  useEffect(() => {
    if (!processing) return
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && job.current) {
        interrupted.current = true
        job.current.cancel()
      }
    }
    const timer = setTimeout(
      () => {
        interrupted.current = true
        job.current?.cancel()
      },
      (range.end - range.start + 15) * 1000,
    )
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [processing, range])

  const seek = (t: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = t
    setCurrent(t)
  }

  const onTimeUpdate = () => {
    const v = video.current
    if (!v) return
    setCurrent(v.currentTime)
    if (playUntil.current !== null && v.currentTime >= playUntil.current) {
      v.pause()
      playUntil.current = null
    }
  }

  /** 選んだ範囲を再生する（いまの位置が範囲の外なら、始めから） */
  const togglePlay = () => {
    const v = video.current
    if (!v) return
    if (playing) {
      v.pause()
      return
    }
    if (v.currentTime < range.start || v.currentTime >= range.end - 0.05) v.currentTime = range.start
    playUntil.current = range.end
    v.muted = muted
    void v.play()
  }

  // ---- フィルムの取っ手 ----
  const timeAt = (clientX: number) => {
    const rect = strip.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration))
  }

  const onPointerDown = (which: 'start' | 'end' | 'head') => (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 取れなくても、フィルムの上で動かす分には動く
    }
    video.current?.pause()
    dragging.current = which
    if (which === 'head') seek(Math.min(range.end, Math.max(range.start, timeAt(e.clientX))))
  }

  const onPointerMove = (e: PointerEvent) => {
    const which = dragging.current
    if (!which) return
    const t = timeAt(e.clientX)
    if (which === 'start') {
      const start = Math.min(t, range.end - MIN_LENGTH)
      setRange(clampRange({ start, end: range.end }, duration))
      seek(Math.max(0, start))
    } else if (which === 'end') {
      const end = Math.max(t, range.start + MIN_LENGTH)
      setRange(clampRange({ start: range.start, end }, duration))
      seek(Math.min(duration, end))
    } else {
      seek(Math.min(range.end, Math.max(range.start, t)))
    }
  }

  const onPointerUp = () => {
    dragging.current = null
  }

  /** 取っ手を、キーボードや読み上げ（上下のスワイプ）でも0.1秒ずつ動かせるようにする */
  const nudge = (which: 'start' | 'end') => (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.1 : 0
    if (!step) return
    e.preventDefault()
    if (which === 'start') {
      const start = Math.min(Math.max(0, range.start + step), range.end - MIN_LENGTH)
      setRange(clampRange({ start, end: range.end }, duration))
      seek(start)
    } else {
      const end = Math.max(Math.min(duration, range.end + step), range.start + MIN_LENGTH)
      setRange(clampRange({ start: range.start, end }, duration))
      seek(end)
    }
  }

  const trimmed = range.start > 0.05 || range.end < duration - 0.05
  const changed = trimmed || muted

  const done = () => {
    const v = video.current
    if (!v) return
    if (!changed) {
      onClose()
      return
    }
    setError(undefined)
    playUntil.current = null
    // タップの処理の中で AudioContext を作り、再生を始める（iPhone の制限のため）
    audio.current ??= new AudioContext()
    const j = startTrim(v, audio.current, range, name, { muted })
    job.current = j
    interrupted.current = false
    setProcessing(true)
    j.done
      .then((out) => onDone(out))
      .catch((e: unknown) => {
        if (job.current !== j) return
        if (interrupted.current) {
          setError(t.editor.interrupted)
        } else if (!(e instanceof Error && e.message === t.trim.cancelled)) {
          setError(e instanceof Error ? e.message : String(e))
        }
      })
      .finally(() => {
        if (job.current === j) {
          job.current = null
          setProcessing(false)
        }
      })
  }

  const ready = duration > 0
  const pct = (time: number) => `${(duration > 0 ? time / duration : 0) * 100}%`
  const length = range.end - range.start
  const progress = processing && length > 0 ? Math.min(1, Math.max(0, (current - range.start) / length)) : 0

  return (
    <div className="recorder editor" role="dialog" aria-modal="true" aria-label={t.editor.title}>
      <div className="editor-top">
        <button className="editor-text-button" onClick={onClose} disabled={processing}>
          {t.editor.cancel}
        </button>
        <span className="editor-title">{ready ? `${formatTime(length)}` : ''}</span>
        <button className="editor-text-button primary" onClick={done} disabled={!ready || processing}>
          {t.editor.done}
        </button>
      </div>

      <div className="editor-stage">
        <video
          ref={video}
          className="editor-video"
          src={url}
          playsInline
          preload="auto"
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={processing ? undefined : togglePlay}
        />
        {ready && !playing && !processing && (
          <button className="editor-play" aria-label={t.editor.playRange} onClick={togglePlay}>
            <PlayIcon size={30} />
          </button>
        )}
      </div>

      <div className="editor-panel">
        {error && <p className="trimmer-error">{error}</p>}
        {!ready && !error && <p className="editor-status">{t.editor.loading}</p>}
        {ready && !processing && (
          <div className="editor-tools">
            <button
              className={`editor-sound${muted ? ' off' : ''}`}
              aria-pressed={muted}
              aria-label={muted ? t.editor.mutedLabel : t.editor.soundLabel}
              onClick={() => {
                const next = !muted
                setMuted(next)
                if (video.current) video.current.muted = next
              }}
            >
              <SpeakerIcon size={22} off={muted} />
            </button>
            <button
              className="editor-play-small"
              aria-label={playing ? t.player.pause : t.editor.playRange}
              onClick={togglePlay}
            >
              {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
            </button>
            <div
              className="filmstrip"
              ref={strip}
              onPointerDown={onPointerDown('head')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div className="filmstrip-frames" aria-hidden="true">
                {frames.length > 0
                  ? frames.map((f, i) => <img key={i} src={f} alt="" />)
                  : Array.from({ length: FRAMES }, (_, i) => <span key={i} />)}
              </div>
              <div className="filmstrip-shade" style={{ left: 0, width: pct(range.start) }} />
              <div className="filmstrip-shade" style={{ left: pct(range.end), right: 0 }} />
              <div className="filmstrip-frame" style={{ left: pct(range.start), width: pct(length) }}>
                <span
                  className="filmstrip-handle start"
                  role="slider"
                  aria-label={t.editor.start}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={range.start}
                  aria-valuetext={formatTime(range.start)}
                  tabIndex={0}
                  onKeyDown={nudge('start')}
                  onPointerDown={onPointerDown('start')}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
                <span
                  className="filmstrip-handle end"
                  role="slider"
                  aria-label={t.editor.end}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={range.end}
                  aria-valuetext={formatTime(range.end)}
                  tabIndex={0}
                  onKeyDown={nudge('end')}
                  onPointerDown={onPointerDown('end')}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
              </div>
              <div className="filmstrip-head" style={{ left: pct(current) }} aria-hidden="true" />
            </div>
          </div>
        )}
        {ready && !processing && (
          <p className="editor-note">
            {changed
              ? t.editor.willRebuild(Math.ceil(length))
              : t.editor.hint}
          </p>
        )}
        {processing && (
          <div className="editor-progress">
            <p>{t.editor.exporting(Math.round(progress * 100))}</p>
            <div className="progress" aria-hidden="true">
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <button className="editor-text-button" onClick={() => job.current?.cancel()}>
              {t.editor.cancel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

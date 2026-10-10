import { useEffect, useRef, useState } from 'react'
import { inMemory, probeDuration } from '../data/mediaPrep'
import { traceVideo } from '../debug'
import { clampRange, startTrim, type TrimJob, type TrimRange } from '../data/trim'

function formatTime(sec: number) {
  const s = Math.max(0, sec)
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

/**
 * 動画の始めと終わりを決めて切り取る画面。
 * 「今の位置を始めに／終わりに」で大まかに決め、スライダーで細かく合わせる
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
  const audio = useRef<AudioContext | null>(null)
  const job = useRef<TrimJob | null>(null)
  const previewEnd = useRef<number | null>(null)
  const interrupted = useRef(false)
  const [url, setUrl] = useState<string>()
  const [duration, setDuration] = useState(0)
  const [range, setRange] = useState<TrimRange>({ start: 0, end: 0 })
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string>()

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
      .catch(() => setError('動画を読み込めませんでした'))
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
    const untrace = traceVideo(v, 'preview')
    probeDuration(v)
      .then(async (d) => {
        if (!d) throw new Error('no duration')
        setDuration(d)
        setRange({ start: 0, end: d })
        // iPhone はタップするまで動画のデータを読み込まず、コマが表示されない（真っ黒になる）。
        // 音なしの再生はタップなしでも許されるので、一度だけ再生して止め、データを読み込ませる
        v.muted = true
        await v.play().catch(() => {})
        v.pause()
        v.currentTime = 0
      })
      .catch(() => setError('動画の長さを読み取れませんでした'))
    return untrace
  }, [url])

  // 切り取りの途中で別のアプリに切り替えると再生が止まり、録り直しも止まるので、中断して知らせる
  useEffect(() => {
    if (!processing) return
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && job.current) {
        interrupted.current = true
        job.current.cancel()
      }
    }
    // 長さ＋15秒たっても終わらなければ止める（再生が進まないとき）
    const timer = setTimeout(() => {
      interrupted.current = true
      job.current?.cancel()
    }, (range.end - range.start + 15) * 1000)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [processing, range])

  const onTimeUpdate = () => {
    const v = video.current
    if (!v) return
    setCurrent(v.currentTime)
    if (previewEnd.current !== null && v.currentTime >= previewEnd.current) {
      v.pause()
      previewEnd.current = null
    }
  }

  const seek = (t: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = t
    setCurrent(t)
  }

  const setRangeSafe = (next: TrimRange) => setRange(clampRange(next, duration))

  const previewRange = () => {
    const v = video.current
    if (!v) return
    previewEnd.current = range.end
    v.currentTime = range.start
    // 範囲の確認は音つきで（ボタンを押した中なので許される）
    v.muted = false
    void v.play()
  }

  const trim = () => {
    const v = video.current
    if (!v) return
    setError(undefined)
    previewEnd.current = null
    // タップの処理の中で AudioContext を作り、再生を始める（iPhone の制限のため）
    audio.current ??= new AudioContext()
    const j = startTrim(v, audio.current, range, name)
    job.current = j
    interrupted.current = false
    setProcessing(true)
    j.done
      .then((out) => onDone(out))
      .catch((e: unknown) => {
        if (job.current !== j) return
        if (interrupted.current) {
          setError('途中で止まりました。この画面を開いたまま、もう一度「切り取る」を押してください。')
        } else if (!(e instanceof Error && e.message === 'キャンセルしました')) {
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

  const length = range.end - range.start
  const progress = processing && length > 0 ? Math.min(1, Math.max(0, (current - range.start) / length)) : 0
  const ready = duration > 0

  return (
    <div className="recorder trimmer" role="dialog" aria-modal="true" aria-label="動画を切り取る">
      <video
        ref={video}
        className="recorder-preview trimmer-video"
        src={url}
        playsInline
        preload="auto"
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="recorder-top">
        <button className="btn small" onClick={onClose} disabled={processing}>
          やめる
        </button>
        <span className="trimmer-length">切り取る長さ {formatTime(length)}</span>
      </div>

      <div className="trimmer-panel">
        {error && <p className="trimmer-error">{error}</p>}
        {!ready && !error && <p>読み込んでいます…</p>}
        {ready && !processing && (
          <>
            <div className="trimmer-row">
              <button
                className="btn small"
                onClick={() => {
                  const v = video.current
                  if (!v) return
                  if (playing) {
                    v.pause()
                  } else {
                    v.muted = false
                    void v.play()
                  }
                }}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <input
                type="range"
                aria-label="再生位置"
                min={0}
                max={duration}
                step={0.05}
                value={current}
                onChange={(e) => seek(Number(e.target.value))}
              />
              <span className="trimmer-time">{formatTime(current)}</span>
            </div>
            <div className="trimmer-row">
              <button className="btn small" onClick={() => setRangeSafe({ ...range, start: current })}>
                今の位置を始めに
              </button>
              <button className="btn small" onClick={() => setRangeSafe({ ...range, end: current })}>
                今の位置を終わりに
              </button>
            </div>
            <label className="trimmer-slider">
              <span>始め {formatTime(range.start)}</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={range.start}
                onChange={(e) => {
                  setRangeSafe({ ...range, start: Number(e.target.value) })
                  seek(Number(e.target.value))
                }}
              />
            </label>
            <label className="trimmer-slider">
              <span>終わり {formatTime(range.end)}</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={range.end}
                onChange={(e) => {
                  setRangeSafe({ ...range, end: Number(e.target.value) })
                  seek(Number(e.target.value))
                }}
              />
            </label>
            <div className="trimmer-row">
              <button className="btn small" onClick={previewRange}>
                ▶ 範囲を再生
              </button>
              <button
                className="btn primary"
                disabled={range.start <= 0.05 && range.end >= duration - 0.05}
                onClick={trim}
              >
                ✂ 切り取る
              </button>
            </div>
            <p className="trimmer-note">
              選んだ範囲を再生しながら作り直します（{Math.ceil(length)}秒ほどかかります）。終わるまでこの画面を開いたままにしてください。
            </p>
          </>
        )}
        {processing && (
          <>
            <p>切り取っています…（{Math.round(progress * 100)}%）</p>
            <div className="progress" aria-hidden="true">
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <button className="btn small" onClick={() => job.current?.cancel()}>
              キャンセル
            </button>
          </>
        )}
      </div>
    </div>
  )
}

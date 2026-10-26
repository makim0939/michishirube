import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { composeClips, MIN_CLIP_SECONDS } from '../data/compose'
import { inMemory, probeDuration } from '../data/mediaPrep'
import type { VideoQuality } from '../data/videoStorage'
import { BackIcon, ForwardIcon, PauseIcon, PlayIcon } from './icons'
import { FRAMES, formatTime, makeFilmstrip } from './Trimmer'
import { useBackHandler } from './useBackHandler'
import { t } from '../i18n'

/** つなぐ動画 1 本。file は、アプリのファイルにある元の動画の場所（あれば、そのまま書き出しに渡す） */
export interface ComposerClip {
  key: string
  blob: Blob
  file?: string
  poster?: Blob
}

interface Row {
  key: string
  /** 動画の長さ（秒）。読み取るまでは 0 */
  duration: number
  start: number
  end: number
}

/** 動画の長さだけを読み取る（画面には出さない video で、メタデータだけ読む） */
async function blobDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(await inMemory(blob))
  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    return await probeDuration(video)
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

const trimmed = (r: Row) => r.duration > 0 && (r.start > 0.05 || r.end < r.duration - 0.05)

/**
 * 動画をつなぐ（iPhone の写真アプリのように）。下に動画を並べ、選んだ1本の両端の取っ手で範囲を決める。
 * 並べ替えと外すも、選んだ1本に対して行う。「完了」で、並べた順につなぎ、onDone に渡す（つなぎ目はカットのみ）。
 * 作っている間は閉じられない（途中で止めると、元の動画と見分けがつかなくなるため）
 */
export function Composer({
  clips: initialClips,
  quality,
  fileName,
  onDone,
  onClose,
}: {
  clips: ComposerClip[]
  quality: VideoQuality
  fileName: string
  /** order は、つないだ動画の並び順（clips の key）。使わなかった動画は含まない */
  onDone: (file: File, order: string[]) => void
  onClose: () => void
}) {
  // 開いた時点の動画を使い続ける（親の再描画のたびに、新しい配列が渡されても、長さを読み直さない）
  const [clips] = useState(initialClips)
  const video = useRef<HTMLVideoElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const dragging = useRef<'start' | 'end' | 'head' | null>(null)
  const playUntil = useRef<number | null>(null)
  const [rows, setRows] = useState<Row[]>(() => clips.map((c) => ({ key: c.key, duration: 0, start: 0, end: 0 })))
  const [selected, setSelected] = useState(0)
  const [url, setUrl] = useState<string>()
  const [frames, setFrames] = useState<Record<string, string[]>>({})
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useBackHandler(() => {
    if (!busy) onClose()
    return true
  })

  const row = rows[selected]
  const clipOf = (key: string) => clips.find((c) => c.key === key)!
  const selectedKey = row?.key
  const duration = row?.duration ?? 0

  // 全部の動画の長さを読み取る（つなぐ長さを出すため）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const c of clips) {
        try {
          const d = await blobDuration(c.blob)
          if (cancelled) return
          setRows((prev) => prev.map((r) => (r.key === c.key && r.duration === 0 ? { ...r, duration: d, end: d } : r)))
        } catch {
          if (!cancelled) setError(t.editor.durationFailed)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clips])

  // 選んだ動画を、メモリに写して再生できるようにする（iPhone で IndexedDB の動画を直接再生できないことがあるため）
  useEffect(() => {
    if (!selectedKey) return
    let revoked = false
    let u: string | undefined
    setUrl(undefined)
    setPlaying(false)
    setCurrent(0)
    inMemory(clipOf(selectedKey).blob)
      .then((b) => {
        if (revoked) return
        u = URL.createObjectURL(b)
        setUrl(u)
      })
      .catch(() => setError(t.common.videoLoadFailed))
    return () => {
      revoked = true
      if (u) URL.revokeObjectURL(u)
    }
    // clipOf は clips から引くだけなので、選んだ動画が変わったときだけ読み直す
  }, [selectedKey])

  // フィルムのコマ（選んだ動画の分を、一度だけ作る）
  useEffect(() => {
    if (!url || !selectedKey || duration <= 0 || frames[selectedKey]) return
    let cancelled = false
    const key = selectedKey
    makeFilmstrip(url, duration, FRAMES, () => cancelled)
      .then((film) => {
        if (!cancelled) setFrames((prev) => ({ ...prev, [key]: film }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // frames は、作り終えたかの確認にだけ使う（作るたびに読み直さない）
  }, [url, selectedKey, duration])

  // iPhone は、タップするまで動画のデータを読み込まず、最初のコマが出ない。音なしで一度再生して止め、先頭のコマを出す
  useEffect(() => {
    const v = video.current
    if (!v || !url || duration <= 0) return
    let cancelled = false
    void (async () => {
      v.muted = true
      await v.play().catch(() => {})
      v.pause()
      if (cancelled) return
      v.currentTime = rows[selected]?.start ?? 0
      v.muted = false
    })()
    return () => {
      cancelled = true
    }
    // 動画を読み込んだとき（選んだ動画が変わったとき）だけ。取っ手を動かすたびには、やり直さない
  }, [url, duration > 0])

  const patch = (key: string, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)))

  const seek = (time: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = time
    setCurrent(time)
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
    if (!v || !row) return
    if (playing) {
      v.pause()
      return
    }
    if (v.currentTime < row.start || v.currentTime >= row.end - 0.05) v.currentTime = row.start
    playUntil.current = row.end
    v.muted = false
    void v.play()
  }

  // ---- フィルムの取っ手（Trimmer と同じ動き） ----
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
    if (which === 'head' && row) seek(Math.min(row.end, Math.max(row.start, timeAt(e.clientX))))
  }

  const onPointerMove = (e: PointerEvent) => {
    const which = dragging.current
    if (!which || !row) return
    const time = timeAt(e.clientX)
    if (which === 'start') {
      const start = Math.max(0, Math.min(time, row.end - MIN_CLIP_SECONDS))
      patch(row.key, { start })
      seek(start)
    } else if (which === 'end') {
      const end = Math.min(duration, Math.max(time, row.start + MIN_CLIP_SECONDS))
      patch(row.key, { end })
      seek(end)
    } else {
      seek(Math.min(row.end, Math.max(row.start, time)))
    }
  }

  const onPointerUp = () => {
    dragging.current = null
  }

  const move = (delta: -1 | 1) => {
    const to = selected + delta
    if (to < 0 || to >= rows.length) return
    setRows((prev) => {
      const next = [...prev]
      ;[next[selected], next[to]] = [next[to], next[selected]]
      return next
    })
    setSelected(to)
  }

  const remove = () => {
    if (rows.length <= 1) return
    setRows((prev) => prev.filter((_, i) => i !== selected))
    setSelected((s) => Math.max(0, Math.min(s, rows.length - 2)))
  }

  const ready = rows.every((r) => r.duration > 0)
  const total = rows.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0)
  const anyEdit = rows.length > 1 || rows.some(trimmed)

  const done = async () => {
    if (!ready) return
    if (!anyEdit) {
      onClose()
      return
    }
    video.current?.pause()
    setError(undefined)
    setBusy(true)
    try {
      const file = await composeClips(
        rows.map((r) => {
          const c = clipOf(r.key)
          return {
            source: c.file ? { file: c.file } : { blob: c.blob },
            start: r.start,
            // 動画の終わりまで使うときは end を送らない（長さの誤差で、終わりを超えないように）
            ...(r.end >= r.duration - 0.05 ? {} : { end: r.end }),
          }
        }),
        quality,
        fileName,
      )
      onDone(
        file,
        rows.map((r) => r.key),
      )
    } catch (e) {
      setError(e instanceof Error ? t.compose.failedWith(e.message) : t.compose.failed)
    } finally {
      setBusy(false)
    }
  }

  const pct = (time: number) => `${(duration > 0 ? time / duration : 0) * 100}%`
  const length = row ? row.end - row.start : 0
  const film = selectedKey ? frames[selectedKey] : undefined

  return (
    <div className="recorder editor" role="dialog" aria-modal="true" aria-label={t.compose.title}>
      <div className="editor-top">
        <button className="editor-text-button" onClick={onClose} disabled={busy}>
          {t.editor.cancel}
        </button>
        <span className="editor-title">{ready ? formatTime(total) : ''}</span>
        <button className="editor-text-button primary" onClick={() => void done()} disabled={!ready || busy}>
          {t.compose.done}
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
          onClick={busy ? undefined : togglePlay}
        />
        {duration > 0 && !playing && !busy && (
          <button className="editor-play" aria-label={t.editor.playRange} onClick={togglePlay}>
            <PlayIcon size={30} />
          </button>
        )}
      </div>

      <div className="editor-panel">
        {error && <p className="trimmer-error">{error}</p>}
        {!ready && !error && <p className="editor-status">{t.editor.loading}</p>}
        {busy && <p className="editor-status">{t.compose.working}</p>}
        {duration > 0 && !busy && (
          <div className="editor-tools">
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
                {film && film.length > 0
                  ? film.map((f, i) => <img key={i} src={f} alt="" />)
                  : Array.from({ length: FRAMES }, (_, i) => <span key={i} />)}
              </div>
              <div className="filmstrip-shade" style={{ left: 0, width: pct(row.start) }} />
              <div className="filmstrip-shade" style={{ left: pct(row.end), right: 0 }} />
              <div className="filmstrip-frame" style={{ left: pct(row.start), width: pct(length) }}>
                <span
                  className="filmstrip-handle start"
                  role="slider"
                  aria-label={t.editor.start}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={row.start}
                  aria-valuetext={formatTime(row.start)}
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
                  aria-valuenow={row.end}
                  aria-valuetext={formatTime(row.end)}
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

        {/* つなぐ動画の並び。押して選び、選んだ1本を並べ替え・外す */}
        <ul className="clip-row" aria-label={t.compose.clips}>
          {rows.map((r, i) => (
            <li key={r.key}>
              <button
                type="button"
                className={`clip-chip${i === selected ? ' selected' : ''}`}
                aria-pressed={i === selected}
                disabled={busy}
                onClick={() => setSelected(i)}
              >
                <span className="clip-index">{i + 1}</span>
                <span className="clip-length">{r.duration > 0 ? formatTime(r.end - r.start) : '…'}</span>
              </button>
            </li>
          ))}
        </ul>
        {!busy && (
          <div className="clip-tools">
            <button type="button" className="editor-sound" aria-label={t.compose.earlier} disabled={selected === 0} onClick={() => move(-1)}>
              <BackIcon size={20} />
            </button>
            <button
              type="button"
              className="editor-sound"
              aria-label={t.compose.later}
              disabled={selected >= rows.length - 1}
              onClick={() => move(1)}
            >
              <ForwardIcon size={20} />
            </button>
            <button type="button" className="editor-text-button" disabled={rows.length <= 1} onClick={remove}>
              {t.compose.remove}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

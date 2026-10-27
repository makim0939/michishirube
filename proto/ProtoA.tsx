import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Film, Thumb, usePlayer } from './media'
import { fmt, MIN, type Seg } from './model'
import { Shell } from './Shell'
import type { ProtoProps } from './types'

interface Scene {
  id: string
  start: number
  end: number
}

/**
 * 案 A：切り出して集める（写真アプリ型）。
 * 大きな取っ手（幅 44pt）で「使いたい範囲」を 1 つ決め、「この場面を入れる」で、下のカードに集める。
 * 取り込み済みの範囲は、フィルムで色が付き、取っ手は入り込めない（重ならない）。並べ替えは、カードの ◀ ▶。
 * 頭・尻を切る＝1 場面だけ入れる。途中を抜く＝抜いた前後を、2 場面として入れる。
 */
export function ProtoA({ url, dur, mode, onRanges, onDone, onDiscard, onSoftClose }: ProtoProps) {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [a, setA] = useState(0)
  const [b, setB] = useState(dur)
  const [dirty, setDirty] = useState(false)
  const segsRef = useRef<Seg[]>([])
  const strip = useRef<HTMLDivElement>(null)
  const p = usePlayer(segsRef)
  const id = useRef(0)

  // 取り込み済みの範囲に、取っ手が入り込まないようにする：いまの範囲が収まる、空きの両端
  const free = (t: number) => {
    const sorted = [...scenes].sort((x, y) => x.start - y.start)
    let lo = 0
    let hi = dur
    for (const s of sorted) {
      if (s.end <= t + 1e-6) lo = Math.max(lo, s.end)
      if (s.start >= t - 1e-6) hi = Math.min(hi, s.start)
    }
    return { lo, hi }
  }

  useEffect(() => {
    setB(dur)
  }, [dur])
  useEffect(() => {
    onRanges(scenes.map((s) => ({ start: s.start, end: s.end })))
  }, [scenes])
  // 最初は何も入れていない：できあがりは、動画まるごと（切らない）
  useEffect(() => {
    if (!scenes.length) onRanges([{ start: 0, end: dur }])
  }, [scenes.length, dur])

  const drag = useRef<'a' | 'b' | null>(null)
  const timeAt = (x: number) => {
    const r = strip.current!.getBoundingClientRect()
    return Math.min(dur, Math.max(0, ((x - r.left) / r.width) * dur))
  }
  const down = (w: 'a' | 'b') => (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    p.pause()
    drag.current = w
  }
  const move = (e: PointerEvent) => {
    const w = drag.current
    if (!w) return
    const t = timeAt(e.clientX)
    if (w === 'a') {
      const { lo } = free(b - 0.01)
      const v = Math.max(lo, Math.min(t, b - MIN))
      setA(v)
      p.seek(v)
    } else {
      const { hi } = free(a + 0.01)
      const v = Math.min(hi, Math.max(t, a + MIN))
      setB(v)
      p.seek(v)
    }
  }
  const up = () => {
    drag.current = null
  }

  const add = () => {
    setDirty(true)
    setScenes((s) => [...s, { id: `a${++id.current}`, start: a, end: b }])
    // 次の範囲：入れた範囲より後ろの空きの先頭から、次の取り込み済みまで
    const sorted = [...scenes, { start: a, end: b }].sort((x, y) => x.start - y.start)
    const gap = (() => {
      let cur = 0
      for (const s of sorted) {
        if (s.start - cur >= MIN) return { lo: cur, hi: s.start }
        cur = s.end
      }
      return dur - cur >= MIN ? { lo: cur, hi: dur } : { lo: 0, hi: 0 }
    })()
    setA(gap.lo)
    setB(gap.hi)
    p.seek(gap.lo)
  }
  const remove = (sid: string) => {
    setDirty(true)
    setScenes((s) => s.filter((x) => x.id !== sid))
  }
  const swap = (i: number, d: -1 | 1) => {
    setDirty(true)
    setScenes((s) => {
      const n = [...s]
      ;[n[i], n[i + d]] = [n[i + d], n[i]]
      return n
    })
  }
  const pct = (t: number) => `${(t / dur) * 100}%`
  const sum = scenes.length ? scenes.reduce((n, s) => n + s.end - s.start, 0) : dur
  const canAdd = b - a >= MIN

  // 範囲の中だけ再生する
  useEffect(() => {
    segsRef.current = [{ id: 'x', start: 0, end: a, off: true }, { id: 'y', start: a, end: b, off: false }, { id: 'z', start: b, end: dur + 1, off: true }]
  }, [a, b, dur])

  return (
    <Shell mode={mode} dirty={dirty} length={fmt(sum)} onDone={onDone} onDiscard={onDiscard} onSoftClose={onSoftClose}>
      <div className="p-stage">
        <video ref={p.v} src={url} playsInline preload="auto" onClick={() => p.toggle()} />
        {!p.playing && (
          <button className="p-bigplay" aria-label="再生" onClick={() => p.play(p.time < a || p.time >= b - 0.05 ? a : undefined)}>
            ▶
          </button>
        )}
      </div>
      <div className="p-strip" ref={strip}>
        <Film url={url} dur={dur} n={10} />
        {scenes.map((s) => (
          <div key={s.id} className="p-block taken" style={{ left: pct(s.start), width: pct(s.end - s.start) }} />
        ))}
        <div className="p-shade" style={{ left: 0, width: pct(a) }} />
        <div className="p-shade" style={{ left: pct(b), right: 0 }} />
        <div className="p-range" style={{ left: pct(a), width: pct(b - a) }}>
          <span className="p-h start" onPointerDown={down('a')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          <span className="p-h end" onPointerDown={down('b')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        </div>
        <div className="p-bar-head" style={{ left: pct(p.time) }} />
      </div>
      <div className="p-row">
        <span className="p-mute">
          {fmt(a)} – {fmt(b)}
        </span>
        <button className="p-text strong" disabled={!canAdd} onClick={add}>
          この場面を入れる
        </button>
      </div>
      <ul className="p-cards h">
        {scenes.map((s, i) => (
          <li key={s.id} className="p-card mini">
            <Thumb url={url} t={s.start + 0.1} className="p-mini-thumb" />
            <div className="p-card-body">
              <b>{i + 1}</b>
              <span>{fmt(s.end - s.start)}</span>
            </div>
            <div className="p-mini-tools">
              <button disabled={i === 0} onClick={() => swap(i, -1)} aria-label="前へ">
                ◀
              </button>
              <button disabled={i === scenes.length - 1} onClick={() => swap(i, 1)} aria-label="後ろへ">
                ▶
              </button>
              <button onClick={() => remove(s.id)} aria-label="外す">
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Shell>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Film, usePlayer } from './media'
import { fmt, kept, markOff, mergeSame, toggleOff, total, useSegs } from './model'
import { Shell } from './Shell'
import type { ProtoProps } from './types'

/** 押してから実際に「いらない」と思うまでの遅れ（秒）。始めの印を、その分だけ戻す */
const LAG = 0.25

/**
 * 案 C：見ながら押す。
 * 動画を再生し、いらない場面の間だけ、大きなボタンを押し続ける（頭・途中・尻、どれも同じ操作）。
 * 手順は「見る → 押す」だけ。細かい位置合わせは無く、印は、下の帯の斜線をタップして戻す。
 */
export function ProtoC({ url, dur, mode, onRanges, onDone, onDiscard, onSoftClose }: ProtoProps) {
  const h = useSegs(dur)
  const segsRef = useRef(h.segs)
  segsRef.current = h.segs
  const p = usePlayer(segsRef)
  const [rate, setRate] = useState(1)
  const [marking, setMarking] = useState<number | null>(null)
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    h.init(dur)
  }, [dur])
  useEffect(() => {
    onRanges(kept(h.segs).map((s) => ({ start: s.start, end: s.end })))
  }, [h.segs])
  useEffect(() => {
    if (p.v.current) p.v.current.playbackRate = rate
  }, [rate, url])

  // 外した区間は、再生中に飛ばす。印をつけている最中は、飛ばさない（いま見ている場面を、見続けるため）
  const startMark = () => {
    const t = p.v.current?.currentTime ?? 0
    setMarking(Math.max(0, t - LAG))
    if (!p.playing) p.play()
  }
  const endMark = () => {
    if (marking === null) return
    const t = p.v.current?.currentTime ?? 0
    const a = marking
    setMarking(null)
    h.set((s) => mergeSame(markOff(s, a, Math.min(dur, t))))
  }

  const tapBar = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect()
    const t = ((e.clientX - r.left) / r.width) * dur
    const s = h.segs.find((x) => t >= x.start && t < x.end)
    if (s?.off) h.set((x) => mergeSame(toggleOff(x, s.id)))
    else p.seek(t)
  }

  return (
    <Shell mode={mode} dirty={h.dirty} length={fmt(total(h.segs))} onDone={onDone} onDiscard={onDiscard} onSoftClose={onSoftClose}>
      <div className="p-stage">
        <video ref={p.v} src={url} playsInline preload="auto" onClick={p.toggle} />
        {!p.playing && marking === null && (
          <button className="p-bigplay" aria-label="再生" onClick={() => p.play()}>
            ▶
          </button>
        )}
      </div>
      <div className="p-bar" ref={bar} onPointerDown={tapBar}>
        <Film url={url} dur={dur} n={10} />
        {h.segs.map((s) => (s.off ? <div key={s.id} className="p-block off" style={{ left: `${(s.start / dur) * 100}%`, width: `${((s.end - s.start) / dur) * 100}%` }} /> : null))}
        {marking !== null && <div className="p-block marking" style={{ left: `${(marking / dur) * 100}%`, width: `${(Math.max(0, p.time - marking) / dur) * 100}%` }} />}
        <div className="p-bar-head" style={{ left: `${(p.time / dur) * 100}%` }} />
      </div>
      <div className="p-row">
        <button className="p-text" onClick={() => setRate(rate === 1 ? 2 : 1)}>
          {rate === 1 ? '×1' : '×2'}
        </button>
        <button className="p-text" onClick={() => p.seek(0)}>
          最初へ
        </button>
        <button className="p-text" disabled={!h.canUndo} onClick={h.undo}>
          取り消す
        </button>
      </div>
      <button
        className={`p-hold${marking !== null ? ' on' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          startMark()
        }}
        onPointerUp={endMark}
        onPointerCancel={endMark}
      >
        {marking !== null ? 'いらない場面…（離すと印）' : 'いらない間、押し続ける'}
      </button>
    </Shell>
  )
}

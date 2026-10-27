import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Film, usePlayer } from './media'
import { fmt, kept, moveBoundary, segAt, splitAt, toggleOff, total, useSegs } from './model'
import { Shell } from './Shell'
import type { ProtoProps } from './types'

/**
 * 案 B：1 本のタイムライン（CapCut・iMovie 型）。
 * 白い線（再生位置）は中央に固定し、フィルムのほうを指で動かして位置を決める。
 * 「選んでから操作」を無くす：白い線の下にある区間が、そのまま操作の対象。
 * 分割点は取っ手（44pt）で動かす。区間は、外すと斜線になる。
 */
export function ProtoB({ url, dur, mode, onRanges, onDone, onDiscard, onSoftClose }: ProtoProps) {
  const h = useSegs(dur)
  const segsRef = useRef(h.segs)
  segsRef.current = h.segs
  const p = usePlayer(segsRef)
  const box = useRef<HTMLDivElement>(null)
  const [pps, setPps] = useState(28)
  const [width, setWidth] = useState(390)
  /** プログラムで合わせたスクロール位置（指で動かしたのと見分ける） */
  const programmatic = useRef(-1)

  useEffect(() => {
    h.init(dur)
  }, [dur])
  useEffect(() => {
    onRanges(kept(h.segs).map((s) => ({ start: s.start, end: s.end })))
  }, [h.segs])
  useEffect(() => {
    const el = box.current
    if (el) setWidth(el.clientWidth)
  }, [])

  // 再生中は、フィルムを再生位置に合わせて動かす
  useEffect(() => {
    const el = box.current
    if (!el || !p.playing) return
    programmatic.current = p.time * pps
    el.scrollLeft = p.time * pps
  }, [p.time, p.playing, pps])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    if (Math.abs(el.scrollLeft - programmatic.current) < 1.5) return
    if (!p.playing) p.seek(Math.min(dur - 0.01, Math.max(0, el.scrollLeft / pps)))
  }

  const here = segAt(h.segs, p.time)
  const idx = h.segs.indexOf(here)
  /** 白い線が分割点の上にあるとき（分割した直後）は、前と後ろのどちらを外すかを選べる */
  const edge = h.segs.findIndex((s, i) => i < h.segs.length - 1 && Math.abs(p.time - s.end) < 0.06)
  const canSplit = h.segs.some((s) => p.time - s.start >= 0.3 && s.end - p.time >= 0.3)

  // 境目の取っ手
  const drag = useRef<{ i: number; x: number; t: number } | null>(null)
  const down = (i: number) => (e: PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    p.pause()
    h.checkpoint()
    drag.current = { i, x: e.clientX, t: h.segs[i].end }
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const t = d.t + (e.clientX - d.x) / pps
    h.set((s) => moveBoundary(s, d.i, t), false)
    p.seek(Math.min(dur - 0.01, Math.max(0, t)))
  }
  const up = () => {
    drag.current = null
  }

  return (
    <Shell mode={mode} dirty={h.dirty} length={fmt(total(h.segs))} onDone={onDone} onDiscard={onDiscard} onSoftClose={onSoftClose}>
      <div className="p-stage">
        <video ref={p.v} src={url} playsInline preload="auto" onClick={p.toggle} />
        {!p.playing && (
          <button className="p-bigplay" aria-label="再生" onClick={() => p.play()}>
            ▶
          </button>
        )}
      </div>
      <div className="p-tl-wrap">
        <div className="p-tl" ref={box} onScroll={onScroll}>
          <div className="p-tl-inner" style={{ width: dur * pps + width, paddingLeft: width / 2 }}>
            <div className="p-tl-track" style={{ width: dur * pps }}>
              <Film url={url} dur={dur} n={Math.max(8, Math.round((dur * pps) / 50))} />
              {h.segs.map((s) => (
                <div
                  key={s.id}
                  className={`p-block${s.off ? ' off' : ''}${s === here ? ' here' : ''}`}
                  style={{ left: s.start * pps, width: (s.end - s.start) * pps }}
                />
              ))}
              {h.segs.slice(0, -1).map((s, i) => (
                <div key={s.id + 'k'} className="p-knob" style={{ left: s.end * pps }} onPointerDown={down(i)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                  <span />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-playhead" aria-hidden="true" />
      </div>
      <div className="p-row">
        <span className="p-mute">{here?.off ? '外した区間' : '残す区間'}</span>
        <label className="p-zoom">
          拡大
          <input type="range" min={12} max={120} value={pps} onChange={(e) => {
            const t = p.time
            setPps(Number(e.target.value))
            requestAnimationFrame(() => {
              if (box.current) {
                programmatic.current = t * Number(e.target.value)
                box.current.scrollLeft = t * Number(e.target.value)
              }
            })
          }} />
        </label>
      </div>
      <div className="p-tools">
        <button className="p-tool" aria-label="再生・止める" onClick={p.toggle}>
          {p.playing ? '❚❚' : '▶'}
        </button>
        <button className="p-tool wide" disabled={!canSplit || edge >= 0} onClick={() => h.set((s) => splitAt(s, p.time))}>
          分割
        </button>
        {edge >= 0 ? (
          <>
            <button className="p-tool wide" onClick={() => h.set((s) => toggleOff(s, h.segs[edge].id))}>
              {h.segs[edge].off ? '前を戻す' : '前を外す'}
            </button>
            <button className="p-tool wide" onClick={() => h.set((s) => toggleOff(s, h.segs[edge + 1].id))}>
              {h.segs[edge + 1].off ? '後ろを戻す' : '後ろを外す'}
            </button>
          </>
        ) : (
          <button className="p-tool wide" onClick={() => h.set((s) => toggleOff(s, here.id))} disabled={!here || (!here.off && kept(h.segs).length <= 1)}>
            {here?.off ? '戻す' : '外す'}
          </button>
        )}
        <button className="p-tool" aria-label="取り消す" disabled={!h.canUndo} onClick={h.undo}>
          ↶
        </button>
      </div>
      <p className="p-hint">区間 {idx + 1}／{h.segs.length}</p>
    </Shell>
  )
}

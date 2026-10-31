import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { ScissorsIcon, PlayIcon, PauseIcon } from '../src/ui/icons'
import { SegFilm, usePlayer } from './media'
import { fmt, kept, mergeOff, markOff, MIN, segAt, splitAt, toggleOff, total, trimEdge, useSegs, type Seg } from './model'
import type { ConfirmMode, ProtoProps, Variant } from './types'

/**
 * 見た目は写真アプリ（いまの「編集」と同じ黒い全画面・黄色の枠と取っ手）、操作は DaVinci Resolve の Cut ページに寄せる。
 *  - 2 段のタイムライン：上は全体（なぞると再生ヘッドが動く）、下は再生ヘッドの周りの拡大（ピンチで倍率を変える）
 *  - 再生ヘッド：どちらの段でも見える。区間の境目に吸い付く
 *  - 分割・頭を切る（Trim Start to Playhead）・尻を切る（Trim End to Playhead）・削除（ripple：間が詰まる）・取り消し・やり直し
 *  - 区間の端を引いてトリム。隣が残す区間なら、境目が一緒に動く（重ならない）
 */

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)
const TrashIcon = () => icon(<><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6.5 7l.8 12.5h9.4L17.5 7" /></>)
const UndoIcon = () => icon(<><path d="M9 7L4.5 11.5 9 16" /><path d="M5 11.5h9a5 5 0 010 10h-3" transform="translate(0 -4)" /></>)
const RedoIcon = () => icon(<><path d="M15 7l4.5 4.5L15 16" /><path d="M19 11.5h-9a5 5 0 000 10h3" transform="translate(0 -4)" /></>)
const TrimHeadIcon = () => icon(<><path d="M5 5v14" /><path d="M9 12h11" /><path d="M13 8l-4 4 4 4" /></>)
const TrimTailIcon = () => icon(<><path d="M19 5v14" /><path d="M15 12H4" /><path d="M11 8l4 4-4 4" /></>)

interface VSeg {
  seg: Seg
  v0: number
  v1: number
}

const SNAP_PX = 7

export function ProtoR({ url, dur, mode, variant, onRanges, onDone, onDiscard, onSoftClose }: ProtoProps & { variant: Variant; mode: ConfirmMode }) {
  const h = useSegs(dur)
  const segsRef = useRef(h.segs)
  segsRef.current = h.segs
  const p = usePlayer(segsRef)
  const ripple = variant.delete === 'ripple'
  const [sel, setSel] = useState<string>()
  const [pxs2, setPxs2] = useState(60)
  const [asking, setAsking] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  /** 帯の幅（画面の幅から、両側の余白を引いたもの） */
  const [W, setW] = useState(362)
  useEffect(() => {
    const measure = () => root.current && setW(root.current.clientWidth - 28)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    h.init(dur)
  }, [dur])
  useEffect(() => {
    onRanges(kept(h.segs).map((s) => ({ start: s.start, end: s.end })))
  }, [h.segs])

  // ---- 表示用の並び（ripple なら、外した区間は消えて詰まる） ----
  const vs: VSeg[] = useMemo(() => {
    let v = 0
    return (ripple ? kept(h.segs) : h.segs).map((seg) => {
      const o = { seg, v0: v, v1: v + seg.end - seg.start }
      v = o.v1
      return o
    })
  }, [h.segs, ripple])
  const T = vs.length ? vs[vs.length - 1].v1 : dur
  const srcToView = (t: number) => {
    const hit = vs.find((x) => t >= x.seg.start && t < x.seg.end)
    if (hit) return hit.v0 + (t - hit.seg.start)
    const next = vs.find((x) => x.seg.start >= t)
    return next ? next.v0 : T
  }
  const viewToSrc = (v: number) => {
    const hit = vs.find((x) => v >= x.v0 && v < x.v1) ?? vs[vs.length - 1]
    return hit ? Math.min(hit.seg.end - 0.001, hit.seg.start + Math.max(0, v - hit.v0)) : 0
  }
  const vph = srcToView(p.time)

  /** 操作の対象：再生ヘッドの下の区間（variant=selected のときは、タップで選んだ区間） */
  const under = segAt(vs.map((x) => x.seg), p.time) ?? h.segs[0]
  const target = (variant.split === 'selected' && sel ? h.segs.find((s) => s.id === sel) : undefined) ?? under
  const tv = vs.find((x) => x.seg.id === target?.id)

  const snap = (v: number, pxs: number) => {
    for (const x of vs.slice(1)) if (Math.abs(x.v0 - v) * pxs < SNAP_PX) return x.v0
    return v
  }
  const scrubTo = (v: number, pxs: number) => {
    p.pause()
    p.seek(viewToSrc(Math.min(T - 0.001, Math.max(0, snap(v, pxs)))))
  }

  // ---- 上の段：全体。なぞると再生ヘッドが動く ----
  const pxs1 = W / Math.max(T, 0.1)
  const ov = useRef<HTMLDivElement>(null)
  const ovScrub = (e: PointerEvent) => {
    const r = ov.current!.getBoundingClientRect()
    scrubTo(((e.clientX - r.left) / r.width) * T, pxs1)
  }
  const ovDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    ovScrub(e)
    if (variant.split === 'selected') {
      const r = ov.current!.getBoundingClientRect()
      const v = ((e.clientX - r.left) / r.width) * T
      setSel(vs.find((x) => v >= x.v0 && v < x.v1)?.seg.id)
    }
  }

  // ---- 下の段：拡大。再生ヘッドは中央に固定、なぞると流れる。2 本指で倍率 ----
  const pts = useRef(new Map<number, number>())
  const cu = useRef<{ x0: number; v0: number; dist0: number; pxs0: number } | null>(null)
  const cuDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pts.current.set(e.pointerId, e.clientX)
    const xs = [...pts.current.values()]
    cu.current = { x0: e.clientX, v0: vph, dist0: xs.length === 2 ? Math.abs(xs[0] - xs[1]) : 0, pxs0: pxs2 }
    if (xs.length === 2) cu.current.dist0 = Math.abs(xs[0] - xs[1])
    p.pause()
    if (variant.split === 'selected' && xs.length === 1) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const v = vph + (e.clientX - rect.left - W / 2) / pxs2
      setSel(vs.find((x) => v >= x.v0 && v < x.v1)?.seg.id)
    }
  }
  const cuMove = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !cu.current) return
    pts.current.set(e.pointerId, e.clientX)
    const xs = [...pts.current.values()]
    if (xs.length === 2) {
      const d = Math.abs(xs[0] - xs[1])
      if (cu.current.dist0 > 0) setPxs2(Math.min(220, Math.max(24, (cu.current.pxs0 * d) / cu.current.dist0)))
      else cu.current.dist0 = d
      return
    }
    scrubTo(cu.current.v0 - (e.clientX - cu.current.x0) / pxs2, pxs2)
  }
  const cuUp = (e: PointerEvent) => {
    pts.current.delete(e.pointerId)
    cu.current = null
  }

  // ---- 区間の端（取っ手）を引く ----
  const hd = useRef<{ id: string; edge: 'start' | 'end'; x0: number; t0: number; pxs: number } | null>(null)
  const handleDown = (edge: 'start' | 'end', pxs: number) => (e: PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    p.pause()
    h.checkpoint()
    hd.current = { id: target.id, edge, x0: e.clientX, t0: target[edge], pxs }
  }
  const handleMove = (e: PointerEvent) => {
    const d = hd.current
    if (!d) return
    e.stopPropagation()
    const t = Math.min(dur, Math.max(0, d.t0 + (e.clientX - d.x0) / d.pxs))
    h.set((s) => trimEdge(s, d.id, d.edge, t, dur), false)
    p.seek(Math.min(dur - 0.01, t))
  }
  const handleUp = () => {
    hd.current = null
  }

  // ---- 操作 ----
  const inTarget = target && p.time - target.start >= MIN && target.end - p.time >= MIN
  const canSplit = !!inTarget
  const canTrimHead = !!target && !target.off && p.time - target.start >= MIN && target.end - p.time >= MIN
  const canTrimTail = canTrimHead
  const keptCount = kept(h.segs).length
  const canDelete = !!target && (target.off || keptCount > 1)

  const split = () => h.set((s) => (inTarget ? splitAt(s, p.time) : s))
  const trimHead = () => h.set((s) => mergeOff(markOff(s, target.start, p.time)))
  const trimTail = () => h.set((s) => mergeOff(markOff(s, p.time, target.end)))
  const remove = () => {
    const id = target.id
    const wasOff = target.off
    h.set((s) => mergeOff(toggleOff(s, id)))
    if (!wasOff) {
      // 削除したあとは、次に残る区間の頭（なければ最後の区間の終わり）へ
      const nextKept = h.segs.find((x) => !x.off && x.start >= target.end - 1e-6)
      const prevKept = [...h.segs].reverse().find((x) => !x.off && x.end <= target.start + 1e-6)
      if (nextKept) p.seek(nextKept.start)
      else if (prevKept) p.seek(Math.max(prevKept.start, prevKept.end - 0.02))
    }
  }
  const cancel = () => {
    if (!h.dirty) return onDiscard()
    if (mode === 'undo') onSoftClose()
    else setAsking(true)
  }

  const frame = (pxs: number, left: number, handleCls: string) =>
    tv && (
      <div className="filmstrip-frame" style={{ left, width: Math.max(2, (tv.v1 - tv.v0) * pxs) }}>
        <span
          className={`filmstrip-handle start ${handleCls}`}
          role="slider"
          aria-label="始め"
          aria-valuenow={target.start}
          onPointerDown={handleDown('start', pxs)}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        />
        <span
          className={`filmstrip-handle end ${handleCls}`}
          role="slider"
          aria-label="終わり"
          aria-valuenow={target.end}
          onPointerDown={handleDown('end', pxs)}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        />
      </div>
    )

  const track = (pxs: number) =>
    vs.map((x) => (
      <div key={x.seg.id} className={`p2-seg${x.seg.off ? ' off' : ''}`} style={{ left: x.v0 * pxs, width: (x.v1 - x.v0) * pxs }}>
        <SegFilm url={url} start={x.seg.start} end={x.seg.end} width={(x.v1 - x.v0) * pxs} />
      </div>
    ))

  const stripHeight = 52
  return (
    <div ref={root} className="recorder editor p2" role="dialog" aria-modal="true" aria-label="仕上げる">
      <div className="editor-top">
        <button className="editor-text-button" onClick={cancel}>
          キャンセル
        </button>
        <span className="editor-title">{fmt(total(h.segs))}</span>
        <button className="editor-text-button primary" onClick={onDone}>
          完了
        </button>
      </div>

      <div className="editor-stage">
        <video ref={p.v} className="editor-video" src={url} playsInline preload="auto" onClick={p.toggle} />
        {!p.playing && (
          <button className="editor-play" aria-label="再生" onClick={() => p.play()}>
            <PlayIcon size={30} />
          </button>
        )}
      </div>

      <div className="editor-panel">
        {/* 上の段：全体 */}
        <div className="p2-ov" style={{ height: stripHeight }}>
          <div className="p2-ov-in" ref={ov} style={{ width: W }} onPointerDown={ovDown} onPointerMove={(e) => e.buttons && !hd.current && ovScrub(e)}>
            {track(pxs1)}
            {frame(pxs1, (tv?.v0 ?? 0) * pxs1, 'wide')}
            <div className="filmstrip-head" style={{ left: vph * pxs1 }} aria-hidden="true" />
          </div>
        </div>

        {/* 下の段：拡大（再生ヘッドは中央） */}
        <div className="p2-cu" style={{ height: 76 }} onPointerDown={cuDown} onPointerMove={cuMove} onPointerUp={cuUp} onPointerCancel={cuUp}>
          <div className="p2-cu-in" style={{ width: T * pxs2, transform: `translateX(${W / 2 - vph * pxs2}px)` }}>
            {track(pxs2)}
            {frame(pxs2, (tv?.v0 ?? 0) * pxs2, 'wide')}
          </div>
          <div className="filmstrip-head" style={{ left: W / 2 }} aria-hidden="true" />
        </div>

        {/* 操作：よく使う順 */}
        <div className="p2-tools">
          <button className="p2-tool" aria-label={p.playing ? '止める' : '再生'} onClick={p.toggle}>
            {p.playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
            <span>{p.playing ? '止める' : '再生'}</span>
          </button>
          <button className="p2-tool" disabled={!canTrimHead} onClick={trimHead} aria-label="頭を切る">
            <TrimHeadIcon />
            <span>頭を切る</span>
          </button>
          <button className="p2-tool" disabled={!canSplit} onClick={split} aria-label="分割">
            <ScissorsIcon size={24} />
            <span>分割</span>
          </button>
          <button className="p2-tool" disabled={!canTrimTail} onClick={trimTail} aria-label="尻を切る">
            <TrimTailIcon />
            <span>尻を切る</span>
          </button>
          <button className="p2-tool" disabled={!canDelete} onClick={remove} aria-label={target?.off ? '戻す' : '削除'}>
            <TrashIcon />
            <span>{target?.off ? '戻す' : '削除'}</span>
          </button>
          <button className="p2-tool" disabled={!h.canUndo} onClick={h.undo} aria-label="取り消す">
            <UndoIcon />
            <span>取り消す</span>
          </button>
          <button className="p2-tool" disabled={!h.canRedo} onClick={h.redo} aria-label="やり直す">
            <RedoIcon />
            <span>やり直す</span>
          </button>
        </div>
      </div>

      {asking && (
        <div className="p2-backdrop" onClick={() => setAsking(false)}>
          <div className="p2-sheet" role="alertdialog" onClick={(e) => e.stopPropagation()}>
            <div className="p2-sheet-group">
              <button className="p2-sheet-btn danger" onClick={onDiscard}>
                変更を破棄
              </button>
            </div>
            <div className="p2-sheet-group">
              <button className="p2-sheet-btn strong" onClick={() => setAsking(false)}>
                続ける
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

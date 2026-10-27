// 試作の共通の形：「元の動画 1 本 ＋ 分割点 ＋ 各区間の 残す／外す」。
// 区間は、0〜動画の長さを隙間なく・重なりなく並べる。頭と尻を切る・途中を抜くは、どちらも「区間を外す」で表す。
import { useCallback, useState } from 'react'

export const MIN = 0.3

export interface Seg {
  id: string
  start: number
  end: number
  off: boolean
}

let counter = 0
export const newId = () => `s${++counter}`

export const initSegs = (duration: number): Seg[] => [{ id: newId(), start: 0, end: duration, off: false }]

/** at の位置で区間を 2 つに分ける（どちらも MIN 以上あるときだけ） */
export function splitAt(segs: Seg[], at: number): Seg[] {
  const i = segs.findIndex((s) => at - s.start >= MIN && s.end - at >= MIN)
  if (i < 0) return segs
  const s = segs[i]
  return [...segs.slice(0, i), { ...s, end: at }, { ...s, id: newId(), start: at }, ...segs.slice(i + 1)]
}

/** i 番目と i+1 番目の境目を t へ動かす（隣は MIN を割らない。重ならない・隙間ができない） */
export function moveBoundary(segs: Seg[], i: number, t: number): Seg[] {
  const a = segs[i]
  const b = segs[i + 1]
  if (!a || !b) return segs
  const v = Math.min(b.end - MIN, Math.max(a.start + MIN, t))
  return segs.map((s, k) => (k === i ? { ...s, end: v } : k === i + 1 ? { ...s, start: v } : s))
}

export const toggleOff = (segs: Seg[], id: string): Seg[] => segs.map((s) => (s.id === id ? { ...s, off: !s.off } : s))

/** [a, b] を外す（両端で区間を分けて、間を外す） */
export function markOff(segs: Seg[], a: number, b: number): Seg[] {
  if (b - a < MIN) return segs
  let next = splitAt(segs, a)
  next = splitAt(next, b)
  return next.map((s) => (s.start >= a - 1e-6 && s.end <= b + 1e-6 ? { ...s, off: true } : s))
}

/** 隣どうしが同じ状態なら、ひとつにまとめる（分割点が増えすぎないように） */
export function mergeSame(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last && last.off === s.off) out[out.length - 1] = { ...last, end: s.end }
    else out.push({ ...s })
  }
  return out
}

export const kept = (segs: Seg[]) => segs.filter((s) => !s.off)
export const total = (segs: Seg[]) => kept(segs).reduce((n, s) => n + s.end - s.start, 0)
export const segAt = (segs: Seg[], t: number) => segs.find((s) => t >= s.start && t < s.end) ?? segs[segs.length - 1]

export const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** 取り消しつきの区間の持ち方 */
export function useSegs(duration: number) {
  const [state, setState] = useState<{ segs: Seg[]; past: Seg[][] }>({ segs: initSegs(duration || 1), past: [] })
  const init = useCallback((d: number) => setState({ segs: initSegs(d), past: [] }), [])
  const set = useCallback((fn: (s: Seg[]) => Seg[], record = true) => {
    setState((p) => {
      const next = fn(p.segs)
      if (next === p.segs) return p
      return { segs: next, past: record ? [...p.past, p.segs] : p.past }
    })
  }, [])
  const undo = useCallback(() => setState((p) => (p.past.length ? { segs: p.past[p.past.length - 1], past: p.past.slice(0, -1) } : p)), [])
  /** ドラッグ中の細かい更新は、履歴に積まない。始めに 1 回だけ積む */
  const checkpoint = useCallback(() => setState((p) => ({ ...p, past: [...p.past, p.segs] })), [])
  return { segs: state.segs, set, undo, init, checkpoint, canUndo: state.past.length > 0, dirty: state.past.length > 0 }
}

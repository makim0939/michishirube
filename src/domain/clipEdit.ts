/**
 * 「仕上げる」画面の編集の形。
 * 動画 1 本ごとに、「0〜動画の長さを隙間なく・重なりなく並べた区間」を持つ。区間は、残す／外す（斜線）のどちらか。
 * 頭を切る・尻を切る・途中を抜く、どれも「区間を外す」で表すので、境目は 1 つの値で持てて、同じ場所が 2 回再生・書き出しされない。
 * 外した区間は、並びに残る（詰めない）ので、戻せる
 */

import type { TextOverlay } from './textOverlay'

/** 区間の最小の長さ（秒）。残す区間どうしは、これを割らない */


export const MIN_SEG = 0.3
/** これより短い「外した区間」は、無いものとする */
const TINY = 0.02

export interface Seg {
  id: string
  start: number
  end: number
  off: boolean
}

/** 編集の中身。order は、つなぐ動画（key）の並び。texts は、動画に重ねるテキスト（動画の中の秒で持つので、並べ替え・分割・削除に付いてくる） */
export interface Doc {
  order: string[]
  segs: Record<string, Seg[]>
  texts: TextOverlay[]
}

let counter = 0
const newId = (key: string) => `${key}#${++counter}`

export const initSegs = (key: string, duration: number): Seg[] => [{ id: newId(key), start: 0, end: duration, off: false }]

export const segKey = (id: string) => id.slice(0, id.lastIndexOf('#'))

/** at の位置で、その位置を含む区間を 2 つに分ける。どちらも MIN_SEG 以上あるときだけ */
export function splitAt(segs: Seg[], key: string, at: number): Seg[] {
  const i = segs.findIndex((s) => at - s.start >= MIN_SEG - 1e-6 && s.end - at >= MIN_SEG - 1e-6)
  if (i < 0) return segs
  const s = segs[i]
  return [...segs.slice(0, i), { ...s, end: at }, { ...s, id: newId(key), start: at }, ...segs.slice(i + 1)]
}

/** 隣どうしの「外した区間」だけをまとめる（残す区間の分割点は、残す） */
function mergeOff(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last && last.off && s.off) out[out.length - 1] = { ...last, end: s.end }
    else out.push({ ...s })
  }
  return out
}

/** 区間を、外す／戻す。外せるのは、残す区間が 1 つ以上残るとき（動画ぜんぶを外すのは、別の判断） */
export function toggleOff(segs: Seg[], id: string): Seg[] {
  return mergeOff(segs.map((s) => (s.id === id ? { ...s, off: !s.off } : s)))
}

/** ほぼ 0 秒になった「外した区間」を消す（消えた分は、隣が埋める） */
function clean(segs: Seg[]): Seg[] {
  const out = [...segs]
  for (let k = out.length - 1; k >= 0; k--) {
    const s = out[k]
    if (s.off && s.end - s.start < TINY && out.length > 1) {
      if (out[k + 1]) out[k + 1] = { ...out[k + 1], start: s.start }
      else out[k - 1] = { ...out[k - 1], end: s.end }
      out.splice(k, 1)
    }
  }
  return out
}

/** 境目（i と i+1 のあいだ）を動かす。外した区間は 0 秒まで縮められる（消える）。残す区間どうしは MIN_SEG を割らない */
function moveBoundary(segs: Seg[], i: number, t: number): Seg[] {
  const a = segs[i]
  const b = segs[i + 1]
  const lo = a.off ? a.start : a.start + MIN_SEG
  const hi = b.off ? b.end : b.end - MIN_SEG
  const v = Math.min(hi, Math.max(lo, t))
  return clean(segs.map((s, k) => (k === i ? { ...s, end: v } : k === i + 1 ? { ...s, start: v } : s)))
}

/**
 * 区間 id の端を、元の動画の t 秒へ動かす（トリム）。
 * 隣が残す区間なら、隣の端も一緒に動く（重ならない）。隣が外した区間なら、それが伸び縮みする。
 * 動画の頭・尻の端なら、そこから t までを「外した区間」にする
 */
export function trimEdge(segs: Seg[], key: string, id: string, edge: 'start' | 'end', t: number, duration: number): Seg[] {
  const i = segs.findIndex((s) => s.id === id)
  if (i < 0) return segs
  const s = segs[i]
  // 動画の頭・尻にある「外した区間」の外側の端は、動かしようがない（動かすと、外した区間が 2 つに割れて、片方だけ戻せてしまう）
  if (s.off && ((edge === 'start' && i === 0) || (edge === 'end' && i === segs.length - 1))) return segs
  if (edge === 'start') {
    if (i > 0) return moveBoundary(segs, i - 1, t)
    const v = Math.min(t, s.end - MIN_SEG)
    if (v < 0.05) return segs
    return [{ id: newId(key), start: 0, end: v, off: true }, { ...s, start: v }, ...segs.slice(1)]
  }
  if (i < segs.length - 1) return moveBoundary(segs, i, t)
  const v = Math.max(t, s.start + MIN_SEG)
  if (v > duration - 0.05) return segs
  return [...segs.slice(0, -1), { ...s, end: v }, { id: newId(key), start: v, end: duration, off: true }]
}

export interface Range {
  key: string
  start: number
  end: number
  duration: number
}

/** できあがりに入る区間（つなぐ順）。同じ動画で隣り合う残す区間は、ひとつにまとめる（分割しただけでは、何も変わらない） */
export function keptRanges(doc: Doc, durations: Record<string, number>): Range[] {
  const out: Range[] = []
  for (const key of doc.order) {
    const duration = durations[key] ?? 0
    for (const s of doc.segs[key] ?? []) {
      if (s.off) continue
      const last = out[out.length - 1]
      if (last && last.key === key && Math.abs(last.end - s.start) < 1e-6) last.end = s.end
      else out.push({ key, start: s.start, end: s.end, duration })
    }
  }
  return out
}

export const totalSeconds = (ranges: Range[]) => ranges.reduce((n, r) => n + r.end - r.start, 0)

/** 動画を、まるごと・元の並びのまま使うか（そのとき、書き出しは要らない） */
export function isUntouched(ranges: Range[], originalOrder: string[], durations: Record<string, number>): boolean {
  return (
    ranges.length === originalOrder.length &&
    ranges.every((r, i) => r.key === originalOrder[i] && r.start < 0.05 && r.end > (durations[r.key] ?? 0) - 0.05)
  )
}

/** order の中で、key の動画を delta だけ動かす（端では、動かさない） */
export function moveClip(order: string[], key: string, delta: -1 | 1): string[] {
  const i = order.indexOf(key)
  const j = i + delta
  if (i < 0 || j < 0 || j >= order.length) return order
  const next = [...order]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** 残す区間が、1 つ以上残るか（ぜんぶ外すと、できあがりが空になる） */
export const hasKept = (doc: Doc) => doc.order.some((k) => (doc.segs[k] ?? []).some((s) => !s.off))

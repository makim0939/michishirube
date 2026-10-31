import { describe, expect, it } from 'vitest'
import { hasKept, initSegs, isUntouched, keptRanges, moveClip, segKey, splitAt, toggleOff, totalSeconds, trimEdge, type Doc } from './clipEdit'

const dur = { a: 24, b: 10 }
const docOf = (a = initSegs('a', 24)): Doc => ({ order: ['a'], segs: { a }, texts: [] })

describe('区間の分割', () => {
  it('位置を含む区間を 2 つに分け、どちらも最短の長さ以上あるときだけ分ける', () => {
    const s = splitAt(initSegs('a', 24), 'a', 5)
    expect(s.map((x) => [x.start, x.end])).toEqual([[0, 5], [5, 24]])
    expect(splitAt(s, 'a', 5.1)).toBe(s)
    expect(splitAt(s, 'a', 0.1)).toBe(s)
  })

  it('区間の id から、動画の key が分かる', () => {
    expect(segKey(initSegs('clip-1', 5)[0].id)).toBe('clip-1')
  })
})

describe('区間を外す（斜線）・戻す', () => {
  it('外した区間は並びに残り、戻せる。外した区間どうしは、ひとつにまとまる', () => {
    let s = splitAt(initSegs('a', 24), 'a', 5)
    s = splitAt(s, 'a', 11)
    const [x, y] = [s[0], s[1]]
    s = toggleOff(s, y.id)
    expect(s.map((v) => v.off)).toEqual([false, true, false])
    s = toggleOff(s, x.id)
    expect(s.map((v) => [v.start, v.end, v.off])).toEqual([[0, 11, true], [11, 24, false]])
    expect(toggleOff(s, s[0].id)[0].off).toBe(false)
  })

  it('できあがりは、残す区間だけ。分割しただけでは、ひとつのまま', () => {
    const s = splitAt(initSegs('a', 24), 'a', 5)
    expect(keptRanges(docOf(s), dur)).toEqual([{ key: 'a', start: 0, end: 24, duration: 24 }])
  })

  it('頭・途中・尻を外すと、残る区間が並ぶ（できあがり 2–5 → 11–20）', () => {
    let s = initSegs('a', 24)
    s = trimEdge(s, 'a', s[0].id, 'start', 2, 24)
    s = splitAt(s, 'a', 5)
    s = splitAt(s, 'a', 11)
    s = toggleOff(s, s[2].id)
    s = splitAt(s, 'a', 20)
    s = toggleOff(s, s[s.length - 1].id)
    const r = keptRanges(docOf(s), dur)
    expect(r.map((x) => [x.start, x.end])).toEqual([[2, 5], [11, 20]])
    expect(totalSeconds(r)).toBe(12)
  })

  it('残す区間が無くなったかを調べられる', () => {
    const s = initSegs('a', 24)
    expect(hasKept(docOf(s))).toBe(true)
    expect(hasKept(docOf(toggleOff(s, s[0].id)))).toBe(false)
  })
})

describe('トリム（境目を引く）', () => {
  it('隣が残す区間なら、境目が一緒に動き、重ならない。隣は最短の長さを割らない', () => {
    const s = splitAt(initSegs('a', 24), 'a', 10)
    const t = trimEdge(s, 'a', s[1].id, 'start', 12, 24)
    expect([t[0].end, t[1].start]).toEqual([12, 12])
    const u = trimEdge(s, 'a', s[1].id, 'start', 99, 24)
    expect(u[1].start).toBeCloseTo(23.7)
    const v = trimEdge(s, 'a', s[1].id, 'start', -5, 24)
    expect(v[0].end).toBeCloseTo(0.3)
  })

  it('動画の頭・尻の端を引くと、そこまでが外した区間になり、引き戻すと消える', () => {
    let s = initSegs('a', 24)
    s = trimEdge(s, 'a', s[0].id, 'start', 3, 24)
    expect(s.map((x) => [x.start, x.end, x.off])).toEqual([[0, 3, true], [3, 24, false]])
    s = trimEdge(s, 'a', s[1].id, 'start', 0, 24)
    expect(s.map((x) => [x.start, x.end, x.off])).toEqual([[0, 24, false]])
    s = trimEdge(s, 'a', s[0].id, 'end', 20, 24)
    expect(s.map((x) => [x.start, x.end, x.off])).toEqual([[0, 20, false], [20, 24, true]])
  })

  it('隣が外した区間なら、それが伸び縮みし、残す区間の長さだけが変わる', () => {
    let s = splitAt(initSegs('a', 24), 'a', 5)
    s = toggleOff(s, s[0].id)
    s = trimEdge(s, 'a', s[1].id, 'start', 8, 24)
    expect(s.map((x) => [x.start, x.end, x.off])).toEqual([[0, 8, true], [8, 24, false]])
  })
})

describe('つなぐ動画', () => {
  it('動画ごとの区間を、並びの順につなぐ', () => {
    const doc: Doc = { order: ['b', 'a'], segs: { a: initSegs('a', 24), b: initSegs('b', 10) }, texts: [] }
    expect(keptRanges(doc, dur).map((r) => r.key)).toEqual(['b', 'a'])
  })

  it('動画の並びを動かす（端では動かさない）', () => {
    expect(moveClip(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveClip(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
  })

  it('何も変えていないかを調べられる（変えていなければ、書き出さない）', () => {
    const doc: Doc = { order: ['a', 'b'], segs: { a: initSegs('a', 24), b: initSegs('b', 10) }, texts: [] }
    const r = keptRanges(doc, dur)
    expect(isUntouched(r, ['a', 'b'], dur)).toBe(true)
    expect(isUntouched(r, ['b', 'a'], dur)).toBe(false)
    const cut = { ...doc, segs: { ...doc.segs, a: trimEdge(doc.segs.a, 'a', doc.segs.a[0].id, 'start', 3, 24) } }
    expect(isUntouched(keptRanges(cut, dur), ['a', 'b'], dur)).toBe(false)
  })
})

describe('頭・尻の「外した区間」の外側の端', () => {
  it('動かしても何も変わらない（外した区間が 2 つに割れない）', () => {
    let s = initSegs('a', 10)
    s = trimEdge(s, 'a', s[0].id, 'start', 3, 10)
    s = trimEdge(s, 'a', s[1].id, 'end', 8, 10)
    expect(s.map((x) => [x.start, x.end, x.off])).toEqual([[0, 3, true], [3, 8, false], [8, 10, true]])
    expect(trimEdge(s, 'a', s[0].id, 'start', 1, 10)).toBe(s)
    expect(trimEdge(s, 'a', s[2].id, 'end', 9, 10)).toBe(s)
  })
})

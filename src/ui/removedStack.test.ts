import { describe, expect, it } from 'vitest'
import { expireUndo, undoAll, undoLast, type Removed } from './removedStack'

const a = { key: 'a' }
const b = { key: 'b' }
const c = { key: 'c' }

describe('外した物を、外した順の逆に戻す', () => {
  it('外した位置に戻る', () => {
    const r = undoLast([a, c], [{ item: b, index: 1 }])
    expect(r.list).toEqual([a, b, c])
    expect(r.restored).toBe(b)
    expect(r.stack).toEqual([])
  })
  it('2つ外しても、押すたびに直近から戻り、両方戻せる', () => {
    // [a, b, c] から b（位置1）を外し、続けて a（位置0）を外した
    const stack: Removed<{ key: string }>[] = [
      { item: b, index: 1 },
      { item: a, index: 0 },
    ]
    const first = undoLast([c], stack)
    expect(first.list).toEqual([a, c])
    const second = undoLast(first.list, first.stack)
    expect(second.list).toEqual([a, b, c])
    expect(second.stack).toEqual([])
  })
  it('位置が範囲外でも、端に入る', () => {
    expect(undoLast([a], [{ item: b, index: 9 }]).list).toEqual([a, b])
    expect(undoLast([a], [{ item: b, index: -1 }]).list).toEqual([b, a])
  })
  it('すでに入っていれば増やさず、積みだけ進める', () => {
    const list = [a, b]
    const r = undoLast(list, [{ item: b, index: 0 }])
    expect(r.list).toBe(list)
    expect(r.restored).toBeUndefined()
    expect(r.stack).toEqual([])
  })
  it('積んである物が無ければ、何もしない', () => {
    const list = [a]
    const r = undoLast(list, [])
    expect(r.list).toBe(list)
    expect(r.restored).toBeUndefined()
  })
})

describe('「元に戻す」の時間切れ', () => {
  const state = { stack: [{ item: a, index: 0 }], at: 1000 }
  it('時間内なら、積みを残す', () => {
    expect(expireUndo(state, 1000 + 4999, 5000)).toBe(state)
  })
  it('時間を過ぎたら、積みを捨てる（あとの「元に戻す」に出てこない）', () => {
    expect(expireUndo(state, 1000 + 5000, 5000).stack).toEqual([])
  })
  it('積みが空なら、何もしない', () => {
    const empty = { stack: [], at: 0 }
    expect(expireUndo(empty, 99999, 5000)).toBe(empty)
  })
})

describe('保存に失敗したとき、外した物をすべて戻す', () => {
  it('外した順の逆に、元の位置へ戻る', () => {
    const stack: Removed<{ key: string }>[] = [
      { item: b, index: 1 },
      { item: a, index: 0 },
    ]
    expect(undoAll([c], stack)).toEqual([a, b, c])
  })
  it('積みが空なら、そのまま', () => {
    const list = [a]
    expect(undoAll(list, [])).toBe(list)
  })
})

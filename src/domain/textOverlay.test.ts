import { describe, expect, it } from 'vitest'
import { clampRange, lanes, moveEnd, moveStart, newText, outputIntervals, TEXT_MIN_SECONDS, wrapLines, type TextOverlay } from './textOverlay'

const base = (over: Partial<TextOverlay> = {}): TextOverlay => ({
  id: 'x',
  key: 'a',
  start: 2,
  end: 5,
  text: 'こんにちは',
  x: 0.5,
  y: 0.78,
  size: 0.055,
  color: '#ffffff',
  font: 'gothic',
  plate: false,
  plateColor: '#1d1712',
  ...over,
})

describe('テキストを置く', () => {
  it('再生ヘッドの位置から 3 秒、表示する', () => {
    const o = newText('a', 4, 20)
    expect([o.start, o.end]).toEqual([4, 7])
  })

  it('動画の終わりまで 3 秒なければ、終わりに収まるよう手前に寄せる', () => {
    const o = newText('a', 19, 20)
    expect(o.end).toBe(20)
    expect(o.end - o.start).toBe(3)
  })

  it('はじめは、ゴシックで、白い文字。背景の板は暗い色（まだ敷かない）', () => {
    const o = newText('a', 0, 10)
    expect([o.font, o.color, o.plate, o.plateColor]).toEqual(['gothic', '#ffffff', false, '#1d1712'])
  })

  it('動画が 3 秒より短ければ、動画の長さまでにする', () => {
    const o = newText('a', 0.5, 2)
    expect([o.start, o.end]).toEqual([0, 2])
  })
})

describe('テキストの時間を動かす', () => {
  it('始めの端は、終わりより最小の長さ手前まで、動画の頭までしか動かせない', () => {
    expect(moveStart(base(), 10, 20).start).toBe(5 - TEXT_MIN_SECONDS)
    expect(moveStart(base(), -3, 20).start).toBe(0)
  })

  it('終わりの端は、始めより最小の長さ先から、動画の終わりまでしか動かせない', () => {
    expect(moveEnd(base(), 0, 20).end).toBe(2 + TEXT_MIN_SECONDS)
    expect(moveEnd(base(), 99, 20).end).toBe(20)
  })

  it('範囲を動画の中に収める', () => {
    expect(clampRange(18, 25, 20)).toEqual({ start: 18, end: 20 })
    expect(clampRange(-2, 1, 20).start).toBe(0)
  })
})

describe('できあがりの時間に直す', () => {
  const ranges = [
    { key: 'a', start: 0, end: 10 },
    { key: 'b', start: 3, end: 8 },
  ]

  it('動画の頭から残していれば、同じ時間になる', () => {
    expect(outputIntervals([base({ start: 2, end: 5 })], ranges)).toEqual([{ id: 'x', start: 2, end: 5 }])
  })

  it('頭を切ったぶん、早く出る', () => {
    expect(outputIntervals([base({ start: 4, end: 7 })], [{ key: 'a', start: 3, end: 10 }])).toEqual([{ id: 'x', start: 1, end: 4 }])
  })

  it('途中を外すと、そこで途切れて 2 つに分かれる', () => {
    const cut = [
      { key: 'a', start: 0, end: 4 },
      { key: 'a', start: 6, end: 10 },
    ]
    expect(outputIntervals([base({ start: 2, end: 8 })], cut)).toEqual([
      { id: 'x', start: 2, end: 4 },
      { id: 'x', start: 4, end: 6 },
    ])
  })

  it('外した区間の中だけにあるテキストは、できあがりに入らない', () => {
    expect(outputIntervals([base({ start: 4.5, end: 5.5 })], [{ key: 'a', start: 0, end: 4 }, { key: 'a', start: 6, end: 10 }])).toEqual([])
  })

  it('2 本目の動画のテキストは、1 本目の長さのあとに出る', () => {
    expect(outputIntervals([base({ key: 'b', start: 4, end: 6 })], ranges)).toEqual([{ id: 'x', start: 11, end: 13 }])
  })

  it('空のテキストは、重ねない', () => {
    expect(outputIntervals([base({ text: '  ' })], ranges)).toEqual([])
  })
})

describe('重なるテキストの段', () => {
  it('同じ時間に重なれば別の段、重ならなければ同じ段', () => {
    const a = base({ id: 'a', start: 0, end: 3 })
    const b = base({ id: 'b', start: 2, end: 5 })
    const c = base({ id: 'c', start: 3, end: 6 })
    expect(lanes([a, b, c], { a: 0 })).toEqual({ a: 0, b: 1, c: 0 })
  })
})

describe('折り返し', () => {
  const measure = (s: string) => Array.from(s).length * 10

  it('改行で分ける', () => {
    expect(wrapLines('ab\ncd', 100, measure)).toEqual(['ab', 'cd'])
  })

  it('幅を超えたら、文字ごとに折り返す', () => {
    expect(wrapLines('あいうえおかき', 30, measure)).toEqual(['あいう', 'えおか', 'き'])
  })
})

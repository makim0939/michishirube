import { describe, expect, it } from 'vitest'
import { restoreAt } from './restoreAt'

const a = { key: 'a' }
const b = { key: 'b' }
const c = { key: 'c' }

describe('外した物を元の位置へ戻す', () => {
  it('外した位置に戻る', () => {
    expect(restoreAt([a, c], b, 1)).toEqual([a, b, c])
  })
  it('位置が範囲外でも、端に入る', () => {
    expect(restoreAt([a], b, 9)).toEqual([a, b])
    expect(restoreAt([a], b, -1)).toEqual([b, a])
  })
  it('すでに入っていれば増やさない', () => {
    const list = [a, b]
    expect(restoreAt(list, b, 0)).toBe(list)
  })
})

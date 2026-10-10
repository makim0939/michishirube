import { describe, expect, it } from 'vitest'
import { clampRange, isLongEnough } from './trim'

describe('切り取りの範囲', () => {
  it('動画の長さに収め、0.3秒より短くしない', () => {
    expect(clampRange({ start: -1, end: 20 }, 10)).toEqual({ start: 0, end: 10 })
    expect(clampRange({ start: 5, end: 5.1 }, 10)).toEqual({ start: 5, end: 5.3 })
    expect(clampRange({ start: 9.9, end: 9.95 }, 10)).toEqual({ start: 9.7, end: 10 })
  })

  it('録れた長さが大きく足りなければ失敗とみなす', () => {
    expect(isLongEnough(9.6, { start: 0, end: 10 })).toBe(true)
    expect(isLongEnough(1.0, { start: 1, end: 2.5 })).toBe(true)
    expect(isLongEnough(3, { start: 0, end: 10 })).toBe(false)
    expect(isLongEnough(0.03, { start: 1, end: 2.5 })).toBe(false)
    // 短い範囲は 0.3 秒の誤差まで認める
    expect(isLongEnough(0.7, { start: 0, end: 1 })).toBe(true)
  })
})

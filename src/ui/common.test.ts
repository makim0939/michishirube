import { describe, expect, it } from 'vitest'
import { formatAgo } from './common'

// 2026-10-16（金）の昼。端末の時刻で組み立てる（日付の境目も端末の時刻で見るため）
const NOW = new Date(2026, 9, 16, 12, 0).getTime()
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h, 0).getTime()

describe('formatAgo', () => {
  it('今日・昨日・N日前・30日以上前（日付）', () => {
    expect(formatAgo(at(2026, 10, 16, 8), NOW)).toBe('今日')
    expect(formatAgo(at(2026, 10, 15, 23), NOW)).toBe('昨日')
    expect(formatAgo(at(2026, 10, 13), NOW)).toBe('3日前')
    expect(formatAgo(at(2026, 9, 17), NOW)).toBe('29日前')
    expect(formatAgo(at(2026, 9, 16), NOW)).toBe('2026/9/16')
  })
})

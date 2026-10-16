import { describe, expect, it } from 'vitest'
import { formatAgo, formatAgoDate } from './common'

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

describe('formatAgoDate', () => {
  it('「今日」「昨日」「N日前」に添える、日付と曜日', () => {
    expect(formatAgoDate(at(2026, 10, 16, 8), NOW)).toBe('10/16（金）')
    expect(formatAgoDate(at(2026, 10, 15, 23), NOW)).toBe('10/15（木）')
    expect(formatAgoDate(at(2026, 10, 13), NOW)).toBe('10/13（火）')
    expect(formatAgoDate(at(2026, 9, 17), NOW)).toBe('9/17（木）')
  })

  it('formatAgo が日付そのものになる30日以上前は、添えるものが無い', () => {
    expect(formatAgoDate(at(2026, 9, 16), NOW)).toBeUndefined()
  })

  it('去年の日付には年を付ける（今年なら付けない）', () => {
    const early = new Date(2026, 0, 5, 12, 0).getTime()
    expect(formatAgoDate(at(2025, 12, 30), early)).toBe('2025/12/30（火）')
    expect(formatAgoDate(at(2026, 1, 4), early)).toBe('1/4（日）')
  })
})

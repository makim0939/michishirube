import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Media } from '../domain/types'
import { formatAgo, sortByRecordDate } from './common'

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

describe('formatAgo（夏時間のある地域）', () => {
  // 夏時間の切り替わる日は23時間・25時間になる。時間の差で数えると、日付が1日ずれる
  const saved = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'America/New_York'
  })
  afterAll(() => {
    // もともと無かったときは消す（undefined を入れると、"undefined" という文字になる）
    if (saved === undefined) delete process.env.TZ
    else process.env.TZ = saved
  })

  it('夏時間が始まる日（23時間）をまたいでも、暦の日付で数える', () => {
    // 2026-03-08 に夏時間が始まる
    const now = new Date(2026, 2, 9, 12, 0).getTime()
    expect(formatAgo(new Date(2026, 2, 7, 23, 30).getTime(), now)).toBe('2日前')
    expect(formatAgo(new Date(2026, 2, 8, 0, 30).getTime(), now)).toBe('昨日')
  })

  it('夏時間が終わる日（25時間）をまたいでも、暦の日付で数える', () => {
    // 2026-11-01 に夏時間が終わる
    const now = new Date(2026, 10, 3, 12, 0).getTime()
    expect(formatAgo(new Date(2026, 9, 31, 0, 30).getTime(), now)).toBe('3日前')
    expect(formatAgo(new Date(2026, 10, 1, 0, 30).getTime(), now)).toBe('2日前')
  })
})

describe('sortByRecordDate', () => {
  const media = (id: string, recordId: string, createdAt: number) => ({ id, recordId, createdAt }) as Media

  it('あとから編集で足した写真も、記録の日時で並ぶ（同じ記録の中は入れた順）', () => {
    const records = new Map([
      ['old', 100],
      ['new', 200],
    ])
    const list = [media('a', 'new', 201), media('b', 'old', 101), media('c', 'old', 300)]
    expect(sortByRecordDate(list, (id) => records.get(id)).map((m) => m.id)).toEqual(['b', 'c', 'a'])
  })

  it('記録が見つからないものは、入れた時刻で並べる', () => {
    const list = [media('a', 'x', 300), media('b', 'old', 101)]
    expect(sortByRecordDate(list, (id) => (id === 'old' ? 100 : undefined)).map((m) => m.id)).toEqual(['b', 'a'])
  })
})

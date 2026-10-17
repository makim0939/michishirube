import { describe, expect, it } from 'vitest'
import { daysBetween, formatFileStamp, spanLabel } from './format'

describe('見比べる2杯の日数', () => {
  it('時刻は見ず、暦の日付の差を数える', () => {
    const at = (d: string) => new Date(d).getTime()
    expect(daysBetween(at('2026-10-11T23:50:00'), at('2026-10-12T00:10:00'))).toBe(1)
    expect(daysBetween(at('2026-10-12T08:00:00'), at('2026-10-12T21:00:00'))).toBe(0)
    // 順番は問わない
    expect(daysBetween(at('2026-10-20T10:00:00'), at('2026-10-01T10:00:00'))).toBe(19)
    // 夏時間などで1日が23・25時間でもずれない
    expect(daysBetween(at('2026-03-01T12:00:00'), at('2026-04-01T12:00:00'))).toBe(31)
  })

  it('同じ日なら「同じ日」', () => {
    expect(spanLabel(0)).toBe('同じ日')
    expect(spanLabel(12)).toBe('12日')
  })
})

describe('ファイル名の日時', () => {
  it('年月日-時分を、0 でそろえて並べる', () => {
    expect(formatFileStamp(new Date(2026, 9, 10, 9, 5))).toBe('20261010-0905')
    expect(formatFileStamp(new Date(2026, 0, 2, 23, 59))).toBe('20260102-2359')
  })
})

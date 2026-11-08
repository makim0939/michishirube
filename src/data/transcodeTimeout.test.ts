import { describe, expect, it } from 'vitest'
import { transcodeTimeoutMs } from './content'

describe('画質をそろえる時間の上限', () => {
  it('小さい動画でも、下限（2 分）は待つ', () => {
    expect(transcodeTimeoutMs(0)).toBe(120_000)
    expect(transcodeTimeoutMs(5_000_000)).toBe(130_000)
  })

  it('大きい動画ほど（長い動画ほど）長く待つ', () => {
    expect(transcodeTimeoutMs(1_000_000_000)).toBeGreaterThan(transcodeTimeoutMs(100_000_000))
    expect(transcodeTimeoutMs(1_000_000_000)).toBe(2_120_000)
  })

  it('負の大きさでも、下限より短くならない', () => {
    expect(transcodeTimeoutMs(-1)).toBe(120_000)
  })
})

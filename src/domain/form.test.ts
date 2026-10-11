import { describe, expect, it } from 'vitest'
import { recentForm } from './form'
import type { Outcome, PracticeRecord } from './types'

const rec = (outcome?: Outcome) => ({ outcome }) as PracticeRecord

describe('recentForm', () => {
  it('新しい順に直近の杯だけを数える', () => {
    const records = [rec('good'), rec('meh'), rec(), rec('bad'), rec('good'), rec('good')]
    expect(recentForm(records, 5)).toEqual({
      outcomes: ['good', 'meh', undefined, 'bad', 'good'],
      good: 2,
      meh: 1,
      bad: 1,
    })
  })

  it('記録が無ければ空', () => {
    expect(recentForm([])).toEqual({ outcomes: [], good: 0, meh: 0, bad: 0 })
  })
})

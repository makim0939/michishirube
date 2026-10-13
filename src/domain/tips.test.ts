import { describe, expect, it } from 'vitest'
import { summarizeTips } from './tips'
import type { PracticeRecord } from './types'

const rec = (id: string, at: number, extra: Partial<PracticeRecord> = {}): PracticeRecord => ({
  id,
  skillId: 's',
  createdAt: at,
  updatedAt: at,
  reason: '',
  nextAction: '',
  mediaIds: [],
  ...extra,
})

describe('自分のコツ', () => {
  it('いちばん新しい次の一手・直近の原因の回数・◎のメモをまとめる', () => {
    // 新しい順
    const records = [
      rec('r5', 5, { outcome: 'good', reason: 'きれいに切れた', nextAction: '' }),
      rec('r4', 4, { outcome: 'bad', causes: ['流量', '切り'], nextAction: '切る前に上げる' }),
      rec('r3', 3, { outcome: 'meh', causes: ['流量'], nextAction: '太く注ぐ' }),
      rec('r2', 2, { outcome: 'good', reason: '  ', causes: ['振り'] }),
      rec('r1', 1, { outcome: 'good', reason: '白が浮いた' }),
    ]
    const tips = summarizeTips(records)
    expect(tips.focus).toEqual({ text: '切る前に上げる', at: 4 })
    // ◎の杯の原因は数えない
    expect(tips.stumbles).toEqual([
      { cause: '流量', count: 2 },
      { cause: '切り', count: 1 },
    ])
    expect(tips.window).toBe(5)
    // メモが空の◎は出さない
    expect(tips.wins.map((w) => w.recordId)).toEqual(['r5', 'r1'])
  })

  it('原因は直近の杯だけを数える', () => {
    const records = [rec('new', 3, { outcome: 'good' }), rec('old', 1, { outcome: 'bad', causes: ['流量'] })]
    expect(summarizeTips(records, { window: 1 }).stumbles).toEqual([])
  })

  it('記録が無ければ空', () => {
    expect(summarizeTips([])).toEqual({ focus: undefined, stumbles: [], window: 0, wins: [] })
  })
})

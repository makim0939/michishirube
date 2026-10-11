import type { Outcome, PracticeRecord } from './types'

/** 最近の調子を見る杯数 */
export const FORM_WINDOW = 10

export interface RecentForm {
  /** 新しい順の結果（記録しなかった杯は undefined） */
  outcomes: (Outcome | undefined)[]
  good: number
  meh: number
  bad: number
}

/**
 * 最近の調子。決められた合格基準の代わりに、直近の杯の結果を数えて見せる（「できた」は本人が決める）。
 * records は新しい順
 */
export function recentForm(records: PracticeRecord[], window = FORM_WINDOW): RecentForm {
  const outcomes = records.slice(0, window).map((r) => r.outcome)
  return {
    outcomes,
    good: outcomes.filter((o) => o === 'good').length,
    meh: outcomes.filter((o) => o === 'meh').length,
    bad: outcomes.filter((o) => o === 'bad').length,
  }
}

import type { Outcome } from './types'

/** 結果の印。今日の画面・記録・YouTube の説明で同じ印を使う */
export const OUTCOME_MARK: Record<Outcome, string> = { good: '◎', meh: '△', bad: '✕' }

export const OUTCOME_LABEL: Record<Outcome, string> = {
  good: `${OUTCOME_MARK.good} 成功`,
  meh: `${OUTCOME_MARK.meh} 惜しい`,
  bad: `${OUTCOME_MARK.bad} 失敗`,
}

/** 2026/10/10 9:05 の形。画面と YouTube のタイトルで同じ書き方にする */
export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

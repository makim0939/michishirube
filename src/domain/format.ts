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

/** 2つの日時が、暦の上で何日離れているか（同じ日なら0。時刻は見ない） */
export function daysBetween(a: number, b: number): number {
  const day = (ts: number) => {
    const d = new Date(ts)
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  }
  return Math.round(Math.abs(day(a) - day(b)) / (24 * 60 * 60 * 1000))
}

/** 見比べる2杯の間の日数の言い方 */
export function spanLabel(days: number): string {
  return days === 0 ? '同じ日' : `${days}日`
}

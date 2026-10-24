import { lang, locale, t } from '../i18n'
import type { Outcome } from './types'

/** 結果の印。今日の画面・記録・YouTube の説明で同じ印を使う */
export const OUTCOME_MARK: Record<Outcome, string> = { good: '◎', meh: '△', bad: '✕' }

export const OUTCOME_LABEL: Record<Outcome, string> = {
  good: `${OUTCOME_MARK.good} ${t.outcome.good}`,
  meh: `${OUTCOME_MARK.meh} ${t.outcome.meh}`,
  bad: `${OUTCOME_MARK.bad} ${t.outcome.bad}`,
}

/** 2026/10/10 の形（英語は Oct 10, 2026） */
export function formatDate(ts: number): string {
  if (lang === 'en') return new Date(ts).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 9:05 の形（英語は 9:05 AM） */
export function formatTime(ts: number): string {
  if (lang === 'en') return new Date(ts).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const d = new Date(ts)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 2026/10/10 9:05 の形。画面と YouTube のタイトルで同じ書き方にする */
export function formatDateTime(ts: number): string {
  return `${formatDate(ts)} ${formatTime(ts)}`
}

/** 20261010-0905 の形（端末の時刻）。バックアップと、共有する動画・写真のファイル名で、同じ書き方にする */
export function formatFileStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
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
  return days === 0 ? t.compare.sameDay : t.compare.days(days)
}

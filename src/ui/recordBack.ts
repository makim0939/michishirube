/** 記録画面で Android の「戻る」が来たときの動き */
export type RecordBack = 'ignore' | 'closeConfirm' | 'askConfirm' | 'leave'

/**
 * 保存中は無視する（確認を出すと、「保存せずに戻る」が進行中の保存と競合する）。
 * 確認が出ていれば閉じて続ける。保存前の内容があれば確認を出す。何も無ければ、そのまま離れてよい
 */
export function recordBackAction(s: { saving: boolean; confirming: boolean; unsaved: boolean }): RecordBack {
  if (s.saving) return 'ignore'
  if (s.confirming) return 'closeConfirm'
  return s.unsaved ? 'askConfirm' : 'leave'
}

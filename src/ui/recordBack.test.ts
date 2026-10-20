import { describe, expect, it } from 'vitest'
import { recordBackAction } from './recordBack'

describe('記録画面の戻る', () => {
  it('保存中は、確認が出ていても未保存でも無視する', () => {
    expect(recordBackAction({ saving: true, confirming: true, unsaved: true })).toBe('ignore')
    expect(recordBackAction({ saving: true, confirming: false, unsaved: true })).toBe('ignore')
  })
  it('確認が出ていれば、確認を閉じて続ける', () => {
    expect(recordBackAction({ saving: false, confirming: true, unsaved: true })).toBe('closeConfirm')
  })
  it('未保存の内容があれば、確認を出す', () => {
    expect(recordBackAction({ saving: false, confirming: false, unsaved: true })).toBe('askConfirm')
  })
  it('未保存の内容が無ければ、そのまま離れる', () => {
    expect(recordBackAction({ saving: false, confirming: false, unsaved: false })).toBe('leave')
  })
})

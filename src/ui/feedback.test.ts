import { describe, expect, it } from 'vitest'
import { toastDuration } from './feedback'

describe('toastDuration', () => {
  it('短い一言は2.5秒', () => {
    expect(toastDuration('同期しました', 'ok', false)).toBe(2500)
  })

  it('エラーとボタン付きは、短くても5秒', () => {
    expect(toastDuration('失敗しました', 'error', false)).toBe(5000)
    expect(toastDuration('No.3 を記録しました', 'ok', true)).toBe(5000)
  })

  it('長い文は、読み終えられるよう文字数に応じて延ばす', () => {
    const message = 'YouTube に上げるには、「アカウント」でログインして、YouTube と連携してください'
    // 40字ほどの案内なら、5秒前後
    expect(toastDuration(message, 'ok', false)).toBe(1500 + message.length * 80)
    expect(toastDuration(message, 'ok', false)).toBeGreaterThan(4000)
    expect(toastDuration(message, 'ok', false)).toBeLessThan(6000)
  })

  it('どれだけ長くても6秒まで', () => {
    expect(toastDuration('あ'.repeat(300), 'ok', false)).toBe(6000)
    expect(toastDuration('あ'.repeat(300), 'error', false)).toBe(6000)
  })
})

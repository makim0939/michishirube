import { describe, expect, it } from 'vitest'
import { accountLabel } from './accountLabel'

describe('ログイン中の表示', () => {
  it('メールが分かるときは、そのまま出す', () => {
    expect(accountLabel('a@example.com')).toBe('a@example.com')
  })
  it('Apple の「メールを隠す」の中継用アドレスは出さず、Apple でログイン中と出す', () => {
    expect(accountLabel('abc123@privaterelay.appleid.com')).toBe('Apple でログイン中')
  })
  it('メールが無いときは、ログイン中とだけ出す', () => {
    expect(accountLabel(undefined)).toBe('ログイン中')
  })
})

import { describe, expect, it } from 'vitest'
import { APP_STORE_REVIEW_URL } from './platform'

describe('App Store の評価の画面', () => {
  it('数字の Apple ID で、評価を書く画面を開く（チーム ID・バンドル ID は使わない）', () => {
    const url = new URL(APP_STORE_REVIEW_URL)
    expect(url.origin).toBe('https://apps.apple.com')
    expect(url.pathname).toMatch(/^\/app\/id\d+$/)
    expect(url.searchParams.get('action')).toBe('write-review')
  })
})

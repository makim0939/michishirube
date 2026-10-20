import { describe, expect, it } from 'vitest'
import { isAppleCancelled, isOurServer, SERVER_URL } from './account'

describe('このアプリのサーバーの URL', () => {
  it('いまの URL と、独自ドメインにする前の URL は、末尾の / があっても同じサーバーとして扱う', () => {
    expect(isOurServer(SERVER_URL)).toBe(true)
    expect(isOurServer(`${SERVER_URL}/`)).toBe(true)
    expect(isOurServer('https://michishirube-api.makim0939.workers.dev/')).toBe(true)
  })

  it('ほかのサーバーは別扱い', () => {
    expect(isOurServer('https://example.com')).toBe(false)
  })
})

describe('Apple の画面を閉じたときの取り消し', () => {
  it('番号 1001 のエラーは、取り消し（エラーにしない）', () => {
    expect(isAppleCancelled(Object.assign(new Error('キャンセル'), { code: '1001' }))).toBe(true)
  })

  it('ほかの番号・番号のないエラー・値が無いものは、取り消しではない', () => {
    expect(isAppleCancelled(Object.assign(new Error('失敗'), { code: '1000' }))).toBe(false)
    expect(isAppleCancelled(new Error('番号がない'))).toBe(false)
    expect(isAppleCancelled(null)).toBe(false)
    expect(isAppleCancelled(undefined)).toBe(false)
    expect(isAppleCancelled('1001')).toBe(false)
  })
})

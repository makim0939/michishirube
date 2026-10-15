import { describe, expect, it } from 'vitest'
import { isOurServer, SERVER_URL } from './account'

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

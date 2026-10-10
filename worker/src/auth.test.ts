import { describe, expect, it } from 'vitest'
import { bearerToken, isAllowedReturn, safeEqual, signState, verifyState } from './auth'
import { BadRequest, parseSyncRequest } from './sync'

describe('トークン', () => {
  it('Bearer を取り出して比べる', () => {
    expect(bearerToken('Bearer abc')).toBe('abc')
    expect(bearerToken('Basic abc')).toBeUndefined()
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('OAuth の state', () => {
  const secret = 'test-secret'

  it('署名した state は戻せるが、改ざん・別の鍵・期限切れは通さない', async () => {
    const now = 1_000_000
    const token = await signState({ returnTo: 'https://example.com/app/', issuedAt: now }, secret)
    expect(await verifyState(token, secret, now + 1000)).toEqual({ returnTo: 'https://example.com/app/', issuedAt: now })
    expect(await verifyState(token, 'other', now)).toBeNull()
    expect(await verifyState(`x${token}`, secret, now)).toBeNull()
    expect(await verifyState(token, secret, now + 11 * 60 * 1000)).toBeNull()
  })

  it('戻り先は許可したオリジンだけ', () => {
    const origins = ['https://makim0939.github.io']
    expect(isAllowedReturn('https://makim0939.github.io/michishirube/', origins)).toBe(true)
    expect(isAllowedReturn('https://evil.example/michishirube/', origins)).toBe(false)
    expect(isAllowedReturn('not a url', origins)).toBe(false)
  })
})

describe('同期リクエストの検査', () => {
  it('正しい形だけを通し、削除では data を捨てる', () => {
    const req = parseSyncRequest({
      since: 3,
      changes: [
        { kind: 'skill', id: 'a', updatedAt: 10, deleted: false, data: { name: 'ハート' } },
        { kind: 'record', id: 'b', updatedAt: 11, deleted: true, data: { x: 1 } },
      ],
    })
    expect(req.changes[1].data).toBeNull()
    expect(() => parseSyncRequest({ since: -1, changes: [] })).toThrow(BadRequest)
    expect(() => parseSyncRequest({ since: 0, changes: [{ kind: 'user', id: 'a', updatedAt: 1, deleted: false, data: {} }] })).toThrow(
      /kind/,
    )
    expect(() => parseSyncRequest({ since: 0, changes: [{ kind: 'skill', id: 'a', updatedAt: 1, deleted: false }] })).toThrow(
      /data/,
    )
  })
})

describe('連携結果のページ', () => {
  it('アプリへ飛ばさず閉じるよう案内し、戻り先は HTML として安全に埋め込む', async () => {
    const { resultPage } = await import('./resultPage')
    const html = resultPage('connected', 'https://makim0939.github.io/michishirube/"><script>')
    expect(html).toContain('YouTube と連携しました')
    expect(html).toContain('閉じる')
    expect(html).not.toContain('<script>')
    expect(html).not.toMatch(/http-equiv="refresh"/)
  })
})

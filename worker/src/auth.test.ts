import { describe, expect, it } from 'vitest'
import { APP_SCHEME, bearerToken, isAllowedAppScheme, isAllowedReturn, safeEqual, signState, verifyState } from './auth'
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
    const token = await signState({ id: 'abc', returnTo: 'https://example.com/app/', issuedAt: now }, secret)
    expect(await verifyState(token, secret, now + 1000)).toEqual({ id: 'abc', returnTo: 'https://example.com/app/', issuedAt: now })
    // アプリ（戻り先なし）でも使える
    const app = await signState({ id: 'abc', issuedAt: now }, secret)
    expect(await verifyState(app, secret, now)).toEqual({ id: 'abc', issuedAt: now })
    expect(await verifyState(token, 'other', now)).toBeNull()
    expect(await verifyState(`x${token}`, secret, now)).toBeNull()
    expect(await verifyState(token, secret, now + 11 * 60 * 1000)).toBeNull()
  })

  it('アプリの URL スキームは、今のものだけ（Bundle ID を変える前のものを含め、よそのアプリへ送らない）', async () => {
    expect(isAllowedAppScheme(APP_SCHEME)).toBe(true)
    expect(isAllowedAppScheme('me.makimura.lattecho')).toBe(false)
    expect(isAllowedAppScheme('io.github.makim0939.lattecho')).toBe(false)
    expect(isAllowedAppScheme('evil.example.app')).toBe(false)
    expect(isAllowedAppScheme(undefined)).toBe(false)
    // state に載せて戻せる。型が違う state は通さない
    const now = 1_000_000
    const token = await signState({ id: 'abc', app: true, scheme: APP_SCHEME, issuedAt: now }, secret)
    expect((await verifyState(token, secret, now))?.scheme).toBe(APP_SCHEME)
    const bad = await signState({ id: 'abc', app: true, scheme: 1 as unknown as string, issuedAt: now }, secret)
    expect(await verifyState(bad, secret, now)).toBeNull()
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
  it('成功したらラテ帳へ戻し、戻り先は HTML・JS として安全に埋め込む', async () => {
    const { resultPage } = await import('./resultPage')
    const html = resultPage('connected', 'youtube', 'https://makim0939.github.io/michishirube/?a="><script></script>')
    expect(html).toContain('YouTube と連携しました')
    expect(html).toContain('location.replace(')
    expect(html).not.toContain('<script></script>')
    expect(resultPage('connected', 'login')).toContain('ログインしました')
    // 失敗したときは自動で移らず、戻るボタンだけ
    expect(resultPage('failed', 'login', 'https://x.example/')).not.toContain('location.replace')
  })
})

describe('Google の id_token', () => {
  it('アカウントの番号とメールアドレスを読む', async () => {
    const { readIdToken } = await import('./accounts')
    const payload = btoa(JSON.stringify({ sub: '1234', email: 'a@example.com' })).replace(/=+$/, '')
    expect(readIdToken(`x.${payload}.y`)).toEqual({ sub: '1234', email: 'a@example.com' })
    expect(() => readIdToken('x.e30.y')).toThrow()
  })
})

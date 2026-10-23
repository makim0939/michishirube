import { describe, expect, it, vi } from 'vitest'
import { PHOTO_MAX_BYTES, PHOTO_QUOTA_BYTES } from '../../shared/protocol'
import { createSession } from './accounts'
import { APP_SCHEME } from './auth'
import app from './index'
import { testD1 } from './testD1'

const challenge = 'a'.repeat(43)

async function setup(extra: Record<string, unknown> = {}) {
  const db = await testD1()
  await db.prepare("INSERT INTO users (id, google_sub, created_at) VALUES ('u1', 'g1', 0)").run()
  const token = await createSession(db, 'u1')
  const env = { DB: db, ALLOWED_ORIGINS: 'https://example.com', APP_TOKEN: 'secret', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', ...extra }
  return { db, token, env }
}

const startBody = (n: number, body: Record<string, unknown> = { app: true, scheme: APP_SCHEME }) =>
  JSON.stringify({ kind: 'login', id: `request-id-${String(n).padStart(8, '0')}`, challenge, ...body })

const start = (env: object, body: string, ip = '203.0.113.1') =>
  app.request('/api/auth/start', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip } }, env)

describe('写真を置く', () => {
  const put = (env: object, token: string, id: string, bytes: number) =>
    app.request(`/api/photos/${id}`, { method: 'PUT', body: new Uint8Array(bytes), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' } }, env)

  it('置ける量を超える写真は断り、同じ id の置き直しは、前の大きさを数えない', async () => {
    const { db, token, env } = await setup()
    // 上限の手前まで埋めておく
    await db
      .prepare("INSERT INTO user_photos (user_id, id, type, data, size, created_at) VALUES ('u1', 'big', 'image/jpeg', x'00', ?1, 0)")
      .bind(PHOTO_QUOTA_BYTES - PHOTO_MAX_BYTES)
      .run()
    expect((await put(env, token, 'p1', PHOTO_MAX_BYTES)).status).toBe(200)
    expect((await put(env, token, 'p1', PHOTO_MAX_BYTES)).status).toBe(200)
    const over = await put(env, token, 'p2', 1)
    expect(over.status).toBe(413)
    expect(await over.json()).toMatchObject({ error: 'quota' })
  })

  it('ログインを確かめたあとにアカウントが削除されていたら、写真を残さない', async () => {
    const { db, token, env } = await setup()
    // 認証（セッションの確認）は通り、書き込みの前に利用者が消えた状態
    await db.prepare("DELETE FROM users WHERE id = 'u1'").run()
    expect((await put(env, token, 'p1', 10)).status).toBe(401)
    expect(await db.prepare('SELECT COUNT(*) AS n FROM user_photos').first()).toEqual({ n: 0 })
  })
})

describe('認可を始める', () => {
  it('アプリから始めるときは、今の URL スキームを伝えてもらう（伝えない・前のスキームは断る）', async () => {
    const { env } = await setup()
    expect((await start(env, startBody(1))).status).toBe(200)
    expect((await start(env, startBody(2, { app: true }))).status).toBe(400)
    expect((await start(env, startBody(3, { app: true, scheme: 'io.github.makim0939.lattecho' }))).status).toBe(400)
    // Web 版は、戻り先の URL で戻る（スキームは要らない）
    expect((await start(env, startBody(4, { returnTo: 'https://example.com/app/' }))).status).toBe(200)
  })

  it('接続元ごとの制限を超えたら、混み合っていると返す（ほかの接続元は通す）', async () => {
    const seen = new Map<string, number>()
    const AUTH_LIMITER = {
      limit: vi.fn(async ({ key }: { key: string }) => {
        seen.set(key, (seen.get(key) ?? 0) + 1)
        return { success: (seen.get(key) ?? 0) <= 2 }
      }),
    }
    const { env } = await setup({ AUTH_LIMITER })
    expect((await start(env, startBody(1))).status).toBe(200)
    expect((await start(env, startBody(2))).status).toBe(200)
    const busy = await start(env, startBody(3))
    expect(busy.status).toBe(429)
    expect(await busy.json()).toMatchObject({ error: 'busy' })
    expect((await start(env, startBody(4), '198.51.100.7')).status).toBe(200)
  })
})

describe('思わぬエラー', () => {
  it('中身（D1 の内部の文など）はアプリに返さず、決まった文を返す', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const DB = {
      prepare: () => {
        throw new Error('D1_ERROR: no such table: sessions')
      },
    }
    const res = await app.request('/api/sync', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer x' } }, { DB, ALLOWED_ORIGINS: '' })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('internal')
    expect(body.message).not.toContain('D1')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('YouTube の鍵の受け渡し', () => {
  const token = (env: object, session: string) =>
    app.request('/api/youtube/token', { method: 'POST', body: JSON.stringify({ refreshToken: 'r' }), headers: { Authorization: `Bearer ${session}` } }, env)

  it('Google が JSON でない応答を返したら、一時的なつながりの問題として返し、応答の中身は返さない', async () => {
    const { token: session, env } = await setup()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })))
    const res = await token(env, session)
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('google_unavailable')
    expect(body.message).not.toContain('html')
    vi.unstubAllGlobals()
    error.mockRestore()
  })

  it('Google のエラーの説明（error_description）は、アプリに返さない', async () => {
    const { token: session, env } = await setup()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }, { status: 401 })))
    const res = await token(env, session)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('OAuth client')
    vi.unstubAllGlobals()
    error.mockRestore()
  })

  it('連携が切れていたら、これまで通り reauth（409）を返す', async () => {
    const { token: session, env } = await setup()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 })))
    const res = await token(env, session)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'reauth' })
    vi.unstubAllGlobals()
  })
})

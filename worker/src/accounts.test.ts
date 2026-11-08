import { describe, expect, it } from 'vitest'
import { AUTH_TTL_MS, createAuthRequest, finishAuthRequest, finishLogin, readAuthRequest, userForSession } from './accounts'
import { testD1 } from './testD1'

async function setup() {
  const db = await testD1()
  await db.prepare("INSERT INTO users (id, google_sub, created_at) VALUES ('u1', 'g1', 0)").run()
  await createAuthRequest(db, { id: 'req1', kind: 'login', challenge: 'c', userId: null })
  return db
}

const sessions = async (db: D1Database) => (await db.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>())?.n

describe('ログインの認可を終える', () => {
  it('待っている認可を終えると、一度きりのコードを返し、結果のセッションが使える', async () => {
    const db = await setup()
    const code = await finishLogin(db, 'req1', 'u1', 'a@example.com')
    expect(code).toBeTypeOf('string')
    const row = await db.prepare("SELECT status, result FROM auth_requests WHERE id = 'req1'").first<{ status: string; result: string }>()
    expect(row?.status).toBe('done')
    const result = JSON.parse(row!.result) as { session: string; email: string }
    expect(result.email).toBe('a@example.com')
    expect(await userForSession(db, result.session)).toBe('u1')
  })

  it('同じ認可が2回戻ってきても、2回目はコードを返さず、だれにも渡らないセッションを作らない', async () => {
    const db = await setup()
    expect(await finishLogin(db, 'req1', 'u1', undefined)).toBeTypeOf('string')
    expect(await finishLogin(db, 'req1', 'u1', undefined)).toBeUndefined()
    expect(await sessions(db)).toBe(1)
  })

  it('取り消し・失敗で先に終わっていたら、コードを返さない', async () => {
    const db = await setup()
    expect(await finishAuthRequest(db, 'req1', 'cancelled')).toBeUndefined()
    expect(await finishLogin(db, 'req1', 'u1', undefined)).toBeUndefined()
    expect(await finishAuthRequest(db, 'req1', 'done', { refreshToken: 'x' })).toBeUndefined()
    expect(await sessions(db)).toBe(0)
  })
})

describe('期限が切れた認可', () => {
  it('読もうとしたときに行ごと消す（受け取られなかった YouTube の鍵を残さない）', async () => {
    const db = await setup()
    await finishAuthRequest(db, 'req1', 'done', { refreshToken: 'secret-token' })
    expect(await readAuthRequest(db, 'req1', Date.now() + AUTH_TTL_MS + 1000)).toBeNull()
    expect(await db.prepare('SELECT COUNT(*) AS n FROM auth_requests').first<{ n: number }>()).toEqual({ n: 0 })
  })
})

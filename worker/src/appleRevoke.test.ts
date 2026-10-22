import { beforeAll, describe, expect, it } from 'vitest'
import { APPLE_ISSUER } from './apple'
import { revokeAppleForUser, rememberAppleToken } from './appleRevoke'

const enc = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** users 表の apple_refresh_token だけを持つ、D1 の代わり */
function fakeDb(initial?: string) {
  const state = { token: initial as string | undefined, deleted: false }
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => ({ t: state.token ?? null }),
        run: async () => {
          if (sql.startsWith('UPDATE')) state.token = args[1] as string
        },
      }),
    }),
  } as unknown as D1Database
  return { db, state }
}

let config: { teamId: string; keyId: string; privateKey: string }
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer)
  config = { teamId: 'T', keyId: 'K', privateKey: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----` }
})

const tokenResponse = (sub: string) =>
  (async () => new Response(JSON.stringify({ refresh_token: 'r-1', id_token: `${enc({})}.${enc({ sub, iss: APPLE_ISSUER })}.x` }))) as unknown as typeof fetch

describe('ログインで、取り消し用のトークンを覚える', () => {
  it('認可コードをトークンに替えて、その人の行に入れる', async () => {
    const { db, state } = fakeDb()
    await rememberAppleToken(db, 'u1', 'apple-1', 'code', config, { fetchImpl: tokenResponse('apple-1') })
    expect(state.token).toBe('r-1')
  })

  it('コードの持ち主が違うときは、入れない', async () => {
    const { db, state } = fakeDb()
    await rememberAppleToken(db, 'u1', 'apple-1', 'code', config, { fetchImpl: tokenResponse('other') })
    expect(state.token).toBeUndefined()
  })

  it('鍵が未登録・コードが無い・Apple に届かないときは、何もせず、エラーにもしない', async () => {
    const { db, state } = fakeDb()
    await rememberAppleToken(db, 'u1', 'apple-1', 'code', null)
    await rememberAppleToken(db, 'u1', 'apple-1', undefined, config)
    await rememberAppleToken(db, 'u1', 'apple-1', 'code', config, { fetchImpl: (async () => { throw new TypeError('network') }) as unknown as typeof fetch })
    expect(state.token).toBeUndefined()
  })
})

describe('退会で、Apple に取り消してもらう', () => {
  it('覚えているトークンで、Apple の取り消しを呼ぶ', async () => {
    const { db } = fakeDb('r-1')
    let sent: URLSearchParams | undefined
    await revokeAppleForUser(db, 'u1', config, {
      fetchImpl: (async (_u: unknown, init: RequestInit) => {
        sent = init.body as URLSearchParams
        return new Response('')
      }) as unknown as typeof fetch,
    })
    expect(sent?.get('token')).toBe('r-1')
  })

  it('トークンが無い人・鍵が未登録のときは、Apple を呼ばない', async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return new Response('')
    }) as unknown as typeof fetch
    await revokeAppleForUser(fakeDb().db, 'u1', config, { fetchImpl })
    await revokeAppleForUser(fakeDb('r-1').db, 'u1', null, { fetchImpl })
    expect(called).toBe(false)
  })

  it('Apple が断っても・届かなくても、例外にしない（退会を止めない）', async () => {
    const { db } = fakeDb('r-1')
    await expect(revokeAppleForUser(db, 'u1', config, { fetchImpl: (async () => new Response('', { status: 400 })) as unknown as typeof fetch })).resolves.toBeUndefined()
    await expect(
      revokeAppleForUser(db, 'u1', config, { fetchImpl: (async () => { throw new TypeError('network') }) as unknown as typeof fetch }),
    ).resolves.toBeUndefined()
  })
})

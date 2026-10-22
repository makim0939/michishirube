import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '../../shared/hash'
import {
  APPLE_AUDIENCE,
  APPLE_ISSUER,
  AppleTokenInvalid,
  AppleUnavailable,
  appleClientSecret,
  exchangeAppleCode,
  resetAppleKeysCache,
  revokeAppleToken,
  verifyAppleIdToken,
} from './apple'

const enc = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const NOW = 1_800_000_000_000
const NONCE = 'abcdefghijklmnop1234'

async function newRsaPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
}

let privateKey: CryptoKey
let jwk: JsonWebKey & { kid: string }
const KID = 'test-key-1'

/** テスト用に、Apple の署名鍵の代わりの RSA 鍵を作り、ID トークンを組み立てる */
async function signToken(payload: Record<string, unknown>, options: { kid?: string; key?: CryptoKey } = {}) {
  const header = enc({ alg: 'RS256', kid: options.kid ?? KID })
  const body = enc({
    iss: APPLE_ISSUER,
    aud: APPLE_AUDIENCE,
    exp: NOW / 1000 + 600,
    sub: '001234.abcdef.0001',
    nonce: await sha256Hex(NONCE),
    ...payload,
  })
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', options.key ?? privateKey, new TextEncoder().encode(`${header}.${body}`)),
  )
  const signature = btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${header}.${body}.${signature}`
}

const fetchKeys = (async () => new Response(JSON.stringify({ keys: [jwk] }))) as unknown as typeof fetch

beforeAll(async () => {
  const pair = await newRsaPair()
  privateKey = pair.privateKey
  const exported = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  jwk = { ...exported, kid: KID }
})

describe('Sign in with Apple の ID トークン', () => {
  beforeEach(() => resetAppleKeysCache())

  it('正しいトークンなら、Apple のユーザーの番号を返す', async () => {
    const token = await signToken({ email: 'user@privaterelay.appleid.com' })
    const id = await verifyAppleIdToken(token, NONCE, { now: NOW, fetchImpl: fetchKeys })
    expect(id).toEqual({ sub: '001234.abcdef.0001', email: 'user@privaterelay.appleid.com' })
  })

  it('メールアドレスが無いトークンでも、番号は返す', async () => {
    const id = await verifyAppleIdToken(await signToken({}), NONCE, { now: NOW, fetchImpl: fetchKeys })
    expect(id.email).toBeUndefined()
  })

  it('別のアプリ向け（宛先が違う）のトークンは受け取らない', async () => {
    const token = await signToken({ aud: 'com.example.other' })
    await expect(verifyAppleIdToken(token, NONCE, { now: NOW, fetchImpl: fetchKeys })).rejects.toBeInstanceOf(AppleTokenInvalid)
  })

  it('発行元が Apple でないトークンは受け取らない', async () => {
    const token = await signToken({ iss: 'https://example.com' })
    await expect(verifyAppleIdToken(token, NONCE, { now: NOW, fetchImpl: fetchKeys })).rejects.toThrow('発行元')
  })

  it('期限が切れたトークンは受け取らない', async () => {
    const token = await signToken({ exp: NOW / 1000 - 1 })
    await expect(verifyAppleIdToken(token, NONCE, { now: NOW, fetchImpl: fetchKeys })).rejects.toThrow('期限')
  })

  it('nonce が合わないトークンは受け取らない（ほかの端末で取ったものを使い回させない）', async () => {
    const token = await signToken({})
    await expect(verifyAppleIdToken(token, 'zzzzzzzzzzzzzzzz9999', { now: NOW, fetchImpl: fetchKeys })).rejects.toThrow('nonce')
  })

  it('署名が違う（別の鍵で作った）トークンは受け取らない', async () => {
    const other = await newRsaPair()
    const token = await signToken({}, { key: other.privateKey })
    await expect(verifyAppleIdToken(token, NONCE, { now: NOW, fetchImpl: fetchKeys })).rejects.toThrow('署名')
  })

  it('形が違うものは受け取らない', async () => {
    await expect(verifyAppleIdToken('not-a-token', NONCE, { now: NOW, fetchImpl: fetchKeys })).rejects.toThrow('形')
  })

  it('形の壊れたトークンは、サーバーの不具合（500）ではなく、不正（AppleTokenInvalid）として扱う', async () => {
    await expect(verifyAppleIdToken('!!!.@@@.###', NONCE, { now: NOW, fetchImpl: fetchKeys })).rejects.toBeInstanceOf(AppleTokenInvalid)
  })

  it('鍵が入れ替わったら、Apple から新しい鍵を取り直して確かめる', async () => {
    // 最初は古い鍵だけを持っている
    const first = await verifyAppleIdToken(await signToken({}), NONCE, { now: NOW, fetchImpl: fetchKeys })
    expect(first.sub).toBe('001234.abcdef.0001')
    // Apple が新しい鍵（kid が違う）で署名したトークン。1 分以上たってから来る
    const other = await newRsaPair()
    const newJwk = { ...((await crypto.subtle.exportKey('jwk', other.publicKey)) as JsonWebKey), kid: 'rotated-key' }
    const rotatedFetch = (async () => new Response(JSON.stringify({ keys: [newJwk] }))) as unknown as typeof fetch
    const token = await signToken({ sub: 'rotated-user' }, { kid: 'rotated-key', key: other.privateKey })
    const id = await verifyAppleIdToken(token, NONCE, { now: NOW + 120_000, fetchImpl: rotatedFetch })
    expect(id.sub).toBe('rotated-user')
  })

  it('知らない kid が続いても、Apple への再取得は 1 分に 1 回まで', async () => {
    let calls = 0
    const counting = (async () => {
      calls++
      return new Response(JSON.stringify({ keys: [jwk] }))
    }) as unknown as typeof fetch
    await verifyAppleIdToken(await signToken({}), NONCE, { now: NOW, fetchImpl: counting })
    expect(calls).toBe(1)
    const unknown = await signToken({}, { kid: 'no-such-key' })
    await expect(verifyAppleIdToken(unknown, NONCE, { now: NOW + 10_000, fetchImpl: counting })).rejects.toThrow('署名の鍵')
    expect(calls).toBe(1)
  })

  it('Apple の公開鍵が取れないときは、トークンの不正ではなく AppleUnavailable にする', async () => {
    const down = (async () => new Response('error', { status: 500 })) as unknown as typeof fetch
    await expect(verifyAppleIdToken(await signToken({}), NONCE, { now: NOW, fetchImpl: down })).rejects.toBeInstanceOf(AppleUnavailable)
  })
})

describe('Apple への取り消し（退会）', () => {
  let publicKey: CryptoKey
  let pem: string
  const config = () => ({ teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: pem })

  beforeAll(async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    publicKey = pair.publicKey
    const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer)
    pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`
  })

  it('client_secret は、.p8 で署名した ES256 の JWT（チーム・鍵・宛先・アプリが入る）', async () => {
    const jwt = await appleClientSecret(config(), NOW)
    const [h, p, sig] = jwt.split('.')
    const decode = (t: string) => JSON.parse(atob(t.replace(/-/g, '+').replace(/_/g, '/')))
    expect(decode(h)).toEqual({ alg: 'ES256', kid: 'KEY1234567' })
    expect(decode(p)).toEqual({ iss: 'TEAM123456', iat: NOW / 1000, exp: NOW / 1000 + 300, aud: APPLE_ISSUER, sub: APPLE_AUDIENCE })
    const bytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, bytes, new TextEncoder().encode(`${h}.${p}`))).toBe(true)
  })

  it('改行が「\\n」の文字になった鍵（秘密の値の登録で起きやすい）も読める', async () => {
    const flat = { ...config(), privateKey: pem.replace(/\n/g, '\\n') }
    expect((await appleClientSecret(flat, NOW)).split('.')).toHaveLength(3)
  })

  it('認可コードをリフレッシュトークンに替える。Apple が断ったら undefined', async () => {
    let sent: URLSearchParams | undefined
    const idToken = `${enc({ alg: 'RS256' })}.${enc({ sub: 'user-1' })}.x`
    const ok = (async (_u: unknown, init: RequestInit) => {
      sent = init.body as URLSearchParams
      return new Response(JSON.stringify({ refresh_token: 'r-token', id_token: idToken }))
    }) as unknown as typeof fetch
    expect(await exchangeAppleCode(config(), 'code-1', 'user-1', ok)).toBe('r-token')
    // コードの持ち主が、ログインした人と違うときは、そのトークンを使わない
    expect(await exchangeAppleCode(config(), 'code-1', 'someone-else', ok)).toBeUndefined()
    expect(sent?.get('grant_type')).toBe('authorization_code')
    expect(sent?.get('code')).toBe('code-1')
    expect(sent?.get('client_id')).toBe(APPLE_AUDIENCE)
    const ng = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch
    expect(await exchangeAppleCode(config(), 'used', 'user-1', ng)).toBeUndefined()
  })

  it('取り消しは、リフレッシュトークンを渡す。成功は true、失敗は false', async () => {
    let sent: URLSearchParams | undefined
    const ok = (async (_u: unknown, init: RequestInit) => {
      sent = init.body as URLSearchParams
      return new Response('')
    }) as unknown as typeof fetch
    expect(await revokeAppleToken(config(), 'r-token', ok)).toBe(true)
    expect(sent?.get('token')).toBe('r-token')
    expect(sent?.get('token_type_hint')).toBe('refresh_token')
    expect(await revokeAppleToken(config(), 'r-token', (async () => new Response('', { status: 400 })) as unknown as typeof fetch)).toBe(false)
  })
})

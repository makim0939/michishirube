import { beforeAll, describe, expect, it } from 'vitest'
import { APPLE_AUDIENCE, APPLE_ISSUER, AppleTokenInvalid, sha256Hex, verifyAppleIdToken } from './apple'

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
})

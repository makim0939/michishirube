/**
 * Sign in with Apple の ID トークン（アプリが Apple の画面から受け取ったもの）を確かめる。
 * Apple が署名したことと、このアプリ向けに発行されたこと（宛先）・期限・nonce を見る。
 * 取り出すのは、Apple のユーザーの番号（sub）と、あれば Apple のメールアドレス（アプリに返すだけで、保存しない）
 */

export const APPLE_ISSUER = 'https://appleid.apple.com'
/** アプリの Bundle ID（ID トークンの宛先）。公開の値 */
export const APPLE_AUDIENCE = 'me.makimura.lattecho.app'
const KEYS_URL = 'https://appleid.apple.com/auth/keys'
/** 公開鍵は、Apple がときどき入れ替える。1 時間だけ覚える */
const KEYS_TTL_MS = 60 * 60 * 1000

interface Jwk extends JsonWebKey {
  kid?: string
}

let cachedKeys: { keys: Jwk[]; fetchedAt: number } | undefined

export class AppleTokenInvalid extends Error {}

function base64urlToBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(part))) as T
}

/** 文字列の SHA-256（16進数）。アプリは、nonce の SHA-256 を Apple に渡し、サーバーは元の nonce から同じものを作って比べる */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function appleKeys(fetchImpl: typeof fetch, now: number): Promise<Jwk[]> {
  if (cachedKeys && now - cachedKeys.fetchedAt < KEYS_TTL_MS) return cachedKeys.keys
  const res = await fetchImpl(KEYS_URL)
  if (!res.ok) throw new AppleTokenInvalid('Apple の公開鍵を取得できませんでした')
  const keys = ((await res.json()) as { keys: Jwk[] }).keys
  cachedKeys = { keys, fetchedAt: now }
  return keys
}

export interface AppleIdentity {
  /** Apple のユーザーの番号（この人を見分ける値） */
  sub: string
  email?: string
}

/**
 * ID トークンを確かめて、Apple のユーザーの番号を返す。
 * nonce は、アプリが Apple に渡した nonce（の SHA-256）と合うかを見る（ほかのアプリで取ったトークンを使い回させないため）
 */
export async function verifyAppleIdToken(
  idToken: string,
  nonce: string,
  options: { audience?: string; now?: number; fetchImpl?: typeof fetch } = {},
): Promise<AppleIdentity> {
  const now = options.now ?? Date.now()
  const audience = options.audience ?? APPLE_AUDIENCE
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new AppleTokenInvalid('ID トークンの形が違います')
  const [headerPart, payloadPart, signaturePart] = parts
  const header = decodeJson<{ alg?: string; kid?: string }>(headerPart)
  if (header.alg !== 'RS256' || !header.kid) throw new AppleTokenInvalid('署名の方式が違います')

  const key = (await appleKeys(options.fetchImpl ?? fetch, now)).find((k) => k.kid === header.kid)
  if (!key) throw new AppleTokenInvalid('署名の鍵が見つかりません')
  const publicKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    base64urlToBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  )
  if (!valid) throw new AppleTokenInvalid('署名が合いません')

  const payload = decodeJson<{ iss?: string; aud?: string; exp?: number; sub?: string; nonce?: string; email?: string }>(payloadPart)
  if (payload.iss !== APPLE_ISSUER) throw new AppleTokenInvalid('発行元が違います')
  if (payload.aud !== audience) throw new AppleTokenInvalid('このアプリ向けのトークンではありません')
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) throw new AppleTokenInvalid('期限が切れています')
  if (!payload.sub) throw new AppleTokenInvalid('利用者の番号がありません')
  if (payload.nonce !== (await sha256Hex(nonce))) throw new AppleTokenInvalid('nonce が合いません')

  return { sub: payload.sub, ...(payload.email ? { email: payload.email } : {}) }
}

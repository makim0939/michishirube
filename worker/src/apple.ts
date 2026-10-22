/**
 * Sign in with Apple の ID トークン（アプリが Apple の画面から受け取ったもの）を確かめる。
 * Apple が署名したことと、このアプリ向けに発行されたこと（宛先）・期限・nonce を見る。
 * 取り出すのは、Apple のユーザーの番号（sub）と、あれば Apple のメールアドレス（アプリに返すだけで、保存しない）
 */
import { sha256Hex } from '../../shared/hash'

export const APPLE_ISSUER = 'https://appleid.apple.com'
/** アプリの Bundle ID（ID トークンの宛先）。公開の値 */
export const APPLE_AUDIENCE = 'me.makimura.lattecho.app'
const KEYS_URL = 'https://appleid.apple.com/auth/keys'
/** 公開鍵は、Apple がときどき入れ替える。1 時間は覚えてよい */
const KEYS_TTL_MS = 60 * 60 * 1000
/**
 * 知らない kid が来ても、Apple への再取得は 1 分に 1 回まで。
 * 不正な kid を大量に送られても、Apple への通信が増えないようにする
 */
const KEYS_REFETCH_MIN_MS = 60 * 1000

interface Jwk extends JsonWebKey {
  kid?: string
}

let cachedKeys: { keys: Jwk[]; fetchedAt: number } | undefined

/** トークンそのものが不正（改ざん・形の違い・期限切れ など）。利用者に、ログインし直してもらう */
export class AppleTokenInvalid extends Error {}

/** Apple の公開鍵を取れなかった。トークンの問題ではないので、少し待って試してもらう（503） */
export class AppleUnavailable extends Error {}

function base64urlToBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** 壊れた base64 や JSON は、トークンの不正として扱う（500 にしない） */
function decodeJson<T>(part: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64urlToBytes(part))) as T
  } catch {
    throw new AppleTokenInvalid('ID トークンの中身が読めません')
  }
}

/** 公開鍵を取る。force のときは、キャッシュを使わずに取り直す（ただし、1 分以内に取ったものは使い回す） */
async function appleKeys(fetchImpl: typeof fetch, now: number, force = false): Promise<Jwk[]> {
  if (cachedKeys) {
    const age = now - cachedKeys.fetchedAt
    if (!force && age < KEYS_TTL_MS) return cachedKeys.keys
    if (force && age < KEYS_REFETCH_MIN_MS) return cachedKeys.keys
  }
  let res: Response
  try {
    res = await fetchImpl(KEYS_URL)
  } catch {
    throw new AppleUnavailable('Apple の公開鍵を取得できませんでした')
  }
  if (!res.ok) throw new AppleUnavailable('Apple の公開鍵を取得できませんでした')
  const keys = ((await res.json()) as { keys: Jwk[] }).keys
  cachedKeys = { keys, fetchedAt: now }
  return keys
}

/** テスト用：鍵のキャッシュを空にする（本番では使わない） */
export function resetAppleKeysCache() {
  cachedKeys = undefined
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
  const fetchImpl = options.fetchImpl ?? fetch
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new AppleTokenInvalid('ID トークンの形が違います')
  const [headerPart, payloadPart, signaturePart] = parts
  const header = decodeJson<{ alg?: string; kid?: string }>(headerPart)
  if (header.alg !== 'RS256' || !header.kid) throw new AppleTokenInvalid('署名の方式が違います')

  // 鍵が入れ替わったときは、新しい鍵を取り直す（キャッシュのままだと、1 時間ログインできなくなる）
  let key = (await appleKeys(fetchImpl, now)).find((k) => k.kid === header.kid)
  if (!key) key = (await appleKeys(fetchImpl, now, true)).find((k) => k.kid === header.kid)
  if (!key) throw new AppleTokenInvalid('署名の鍵が見つかりません')

  const publicKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  let valid: boolean
  try {
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      base64urlToBytes(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    )
  } catch {
    throw new AppleTokenInvalid('署名の形が違います')
  }
  if (!valid) throw new AppleTokenInvalid('署名が合いません')

  const payload = decodeJson<{ iss?: string; aud?: string; exp?: number; sub?: string; nonce?: string; email?: string }>(payloadPart)
  if (payload.iss !== APPLE_ISSUER) throw new AppleTokenInvalid('発行元が違います')
  if (payload.aud !== audience) throw new AppleTokenInvalid('このアプリ向けのトークンではありません')
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) throw new AppleTokenInvalid('期限が切れています')
  if (!payload.sub) throw new AppleTokenInvalid('利用者の番号がありません')
  if (payload.nonce !== (await sha256Hex(nonce))) throw new AppleTokenInvalid('nonce が合いません')

  return { sub: payload.sub, ...(payload.email ? { email: payload.email } : {}) }
}

/** Apple のトークンの窓口（鍵の署名に使う値）。Apple Developer で作った鍵の情報で、すべて秘密の値（リポジトリには入れない） */
export interface AppleKeyConfig {
  /** Apple Developer のチーム ID */
  teamId: string
  /** 鍵（Sign in with Apple を有効にした .p8）の Key ID */
  keyId: string
  /** .p8 の中身（-----BEGIN PRIVATE KEY----- から）。改行が「\\n」の文字になっていてもよい */
  privateKey: string
}

const TOKEN_URL = 'https://appleid.apple.com/auth/token'
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke'
/** Apple が応答しないとき、ログイン・退会を待たせない */
const APPLE_TIMEOUT_MS = 4000

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jsonB64url = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)))

/** Apple に自分（このアプリのサーバー）を示す client_secret。.p8 で署名した、短い期限の JWT（ES256） */
export async function appleClientSecret(config: AppleKeyConfig, now = Date.now()): Promise<string> {
  const pem = config.privateKey.replace(/\\n/g, '\n')
  const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const iat = Math.floor(now / 1000)
  const header = jsonB64url({ alg: 'ES256', kid: config.keyId })
  // 期限は 5 分。呼ぶたびに作るので、長くしない
  const body = jsonB64url({ iss: config.teamId, iat, exp: iat + 300, aud: APPLE_ISSUER, sub: APPLE_AUDIENCE })
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${body}`)))
  return `${header}.${body}.${b64url(signature)}`
}

/**
 * ログインでアプリが受け取った認可コード（1 回しか使えない・5 分で切れる）を、リフレッシュトークンに替える。
 * 退会のときの取り消しにだけ使う。取れなかったとき・コードの持ち主が expectedSub（ログインした人）と違うときは、undefined
 * （ログインそのものは止めない。別の人のトークンを、この人の行に入れない）
 */
export async function exchangeAppleCode(
  config: AppleKeyConfig,
  code: string,
  expectedSub: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APPLE_AUDIENCE,
      client_secret: await appleClientSecret(config),
      code,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) return undefined
  const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string }
  if (typeof body.refresh_token !== 'string' || !body.refresh_token || typeof body.id_token !== 'string') return undefined
  // id_token は、Apple から直接（TLS で）受け取ったものなので、署名は見ずに、持ち主（sub）だけを照らす
  let sub: string | undefined
  try {
    sub = decodeJson<{ sub?: string }>(body.id_token.split('.')[1] ?? '').sub
  } catch {
    return undefined
  }
  return sub === expectedSub ? body.refresh_token : undefined
}

/** Apple に、このアプリへのログインの許可を取り消してもらう（退会のとき）。成功したら true */
export async function revokeAppleToken(config: AppleKeyConfig, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchImpl(REVOKE_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APPLE_AUDIENCE,
      client_secret: await appleClientSecret(config),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    }),
  })
  return res.ok
}

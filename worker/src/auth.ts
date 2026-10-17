const encoder = new TextEncoder()

/** 長さ以外の情報が処理時間に出ないように比べる */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export function bearerToken(header: string | undefined): string | undefined {
  const m = header?.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim()
}

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))))
}

export interface OAuthState {
  /** アプリが始めた認可の番号（auth_requests の id） */
  id: string
  /** 認可のあとに戻る Web 版の URL（アプリでは無い。アプリへは、アプリの URL スキームで戻る） */
  returnTo?: string
  /** iPhone・Android のアプリから始めた（終わったら、アプリの URL スキームで戻る） */
  app?: boolean
  /** アプリが戻ってきてほしい URL スキーム（許可したものだけ。無ければ、前の版のアプリ向けの LEGACY_APP_SCHEME） */
  scheme?: string
  issuedAt: number
}

const STATE_TTL_MS = 10 * 60 * 1000

/**
 * Google の認可画面に渡す state。認可の番号と戻り先の URL を載せ、改ざんされていないことを署名で確かめる
 */
export async function signState(state: OAuthState, secret: string): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(state)))
  return `${payload}.${await hmac(secret, payload)}`
}

export async function verifyState(token: string, secret: string, now = Date.now()): Promise<OAuthState | null> {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  if (!safeEqual(await hmac(secret, payload), signature)) return null
  try {
    const state = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as OAuthState
    if (typeof state.id !== 'string' || typeof state.issuedAt !== 'number') return null
    if (state.returnTo !== undefined && typeof state.returnTo !== 'string') return null
    if (state.scheme !== undefined && typeof state.scheme !== 'string') return null
    if (now - state.issuedAt > STATE_TTL_MS || state.issuedAt > now + 60_000) return null
    return state
  } catch {
    return null
  }
}

/** アプリの URL スキーム（Bundle ID と同じ）。認可が終わったら、これでアプリへ戻る */
export const APP_SCHEME = 'me.makimura.lattecho.app'

/** 一つ前の Bundle ID のスキーム。その版のアプリ（開発中の端末）が、スキームを伝えてくる */
export const PREVIOUS_APP_SCHEME = 'me.makimura.lattecho'

/** Bundle ID を変える前の版のアプリの URL スキーム。その版は、スキームを伝えてこないので、これで戻す */
export const LEGACY_APP_SCHEME = 'io.github.makim0939.lattecho'

/** アプリが戻り先に求めた URL スキームが許可したものか（よそのアプリへ、認可の結果を送らないように） */
export function isAllowedAppScheme(scheme: unknown): scheme is string {
  return scheme === APP_SCHEME || scheme === PREVIOUS_APP_SCHEME || scheme === LEGACY_APP_SCHEME
}

export function parseOrigins(list: string): string[] {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** returnTo が許可したオリジンの URL か（よそのサイトへ飛ばされないように） */
export function isAllowedReturn(url: string, origins: string[]): boolean {
  try {
    const u = new URL(url)
    return origins.includes(u.origin)
  } catch {
    return false
  }
}

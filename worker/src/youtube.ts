/**
 * YouTube へのアップロード用の認可。
 * 長く使える refresh token はサーバー（D1）だけに置き、アプリには1時間で切れる access token だけを渡す。
 * アップロード自体は、アプリから YouTube へ直接送る（動画を Worker に通さない）
 */

export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REFRESH_KEY = 'youtube_refresh_token'
const ACCESS_KEY = 'youtube_access_token'

export interface GoogleConfig {
  clientId: string
  clientSecret: string
}

export class ReauthRequired extends Error {}

export function authUrl(config: GoogleConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPE,
    // refresh token を毎回確実に受け取るため、同意画面を出す
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

async function readSecret(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM secrets WHERE key = ?1').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

async function writeSecret(db: D1Database, key: string, value: string) {
  await db
    .prepare(
      'INSERT INTO secrets (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .bind(key, value, Date.now())
    .run()
}

export async function isConnected(db: D1Database): Promise<boolean> {
  return (await readSecret(db, REFRESH_KEY)) !== null
}

export async function disconnect(db: D1Database): Promise<string | null> {
  const refresh = await readSecret(db, REFRESH_KEY)
  await db.prepare('DELETE FROM secrets WHERE key IN (?1, ?2)').bind(REFRESH_KEY, ACCESS_KEY).run()
  return refresh
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  error?: string
  error_description?: string
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  return (await res.json()) as TokenResponse
}

/** 認可コードを refresh token に替えて保存する */
export async function exchangeCode(db: D1Database, config: GoogleConfig, code: string, redirectUri: string) {
  const token = await requestToken({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  if (!token.refresh_token) {
    throw new Error(token.error_description ?? token.error ?? 'refresh token を受け取れませんでした')
  }
  await writeSecret(db, REFRESH_KEY, token.refresh_token)
  if (token.access_token && token.expires_in) {
    await writeSecret(db, ACCESS_KEY, JSON.stringify({ token: token.access_token, exp: Date.now() + token.expires_in * 1000 }))
  }
}

/** アップロード用の access token。期限が近ければ refresh token で取り直す */
export async function accessToken(
  db: D1Database,
  config: GoogleConfig,
  now = Date.now(),
): Promise<{ accessToken: string; expiresAt: number }> {
  const cached = await readSecret(db, ACCESS_KEY)
  if (cached) {
    const { token, exp } = JSON.parse(cached) as { token: string; exp: number }
    // アップロード中に切れないよう、5分以上残っているものだけ使う
    if (exp - now > 5 * 60 * 1000) return { accessToken: token, expiresAt: exp }
  }
  const refresh = await readSecret(db, REFRESH_KEY)
  if (!refresh) throw new ReauthRequired('YouTube と連携していません')
  const token = await requestToken({
    refresh_token: refresh,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  })
  if (token.error === 'invalid_grant') {
    // 連携が取り消された・期限切れ。保存している値は使えないので消す
    await disconnect(db)
    throw new ReauthRequired('YouTube との連携が切れました。もう一度連携してください')
  }
  if (!token.access_token || !token.expires_in) {
    throw new Error(token.error_description ?? token.error ?? 'access token を受け取れませんでした')
  }
  const expiresAt = now + token.expires_in * 1000
  await writeSecret(db, ACCESS_KEY, JSON.stringify({ token: token.access_token, exp: expiresAt }))
  return { accessToken: token.access_token, expiresAt }
}

export async function revoke(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' })
}

/**
 * Google の認可（ログインと YouTube へのアップロード）。
 * YouTube の refresh token はサーバーに保存しない。アプリの端末にだけ置き、アップロードの前に
 * アプリから送ってもらって、1時間で切れる access token に替えて返す（クライアントシークレットがサーバーにしか無いため）。
 * アップロード自体は、アプリから YouTube へ直接送る（動画をサーバーに通さない）
 */

export const LOGIN_SCOPE = 'openid email'
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export interface GoogleConfig {
  clientId: string
  clientSecret: string
}

export class ReauthRequired extends Error {}

export function authUrl(config: GoogleConfig, redirectUri: string, state: string, kind: 'login' | 'youtube'): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    ...(kind === 'login'
      ? { scope: LOGIN_SCOPE, prompt: 'select_account' }
      : // refresh token を毎回確実に受け取るため、同意画面を出す
        { scope: YOUTUBE_SCOPE, access_type: 'offline', prompt: 'consent' }),
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  id_token?: string
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

/** 認可コードを、Google のトークンに替える（保存はしない） */
export async function exchangeCode(config: GoogleConfig, code: string, redirectUri: string): Promise<TokenResponse> {
  const token = await requestToken({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  if (token.error) throw new Error(token.error_description ?? token.error)
  return token
}

/** アプリから受け取った refresh token を、アップロード用の access token に替える */
export async function accessToken(
  config: GoogleConfig,
  refreshToken: string,
  now = Date.now(),
): Promise<{ accessToken: string; expiresAt: number }> {
  const token = await requestToken({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  })
  if (token.error === 'invalid_grant') {
    // 連携が取り消された・期限切れ。アプリは持っている値を消して、連携し直してもらう
    throw new ReauthRequired('YouTube との連携が切れました。もう一度連携してください')
  }
  if (!token.access_token || !token.expires_in) {
    throw new Error(token.error_description ?? token.error ?? 'access token を受け取れませんでした')
  }
  return { accessToken: token.access_token, expiresAt: now + token.expires_in * 1000 }
}

export async function revoke(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' })
}

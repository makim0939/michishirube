import { registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { isNativeApp } from '../platform'
import { sha256Hex } from '../../shared/hash'
import { db } from './db'
import { connectWithConfig, disconnectSync, getSyncConfig, SyncError, type SyncConfig } from './sync'
import { t } from '../i18n'

/**
 * Google でログインして、記録・写真をサーバーに置く（ほかの端末でも同じ記録を使える）。
 * サーバーに置くのは、記録・型・分野・動画と写真の情報・設定・縮小した写真・動画のサムネイルだけ。
 * 動画の中身と YouTube の鍵はサーバーに置かない
 */

/** みんなで使うサーバー（アプリのトップページ・プライバシーポリシーと同じドメイン） */
export const SERVER_URL: string = import.meta.env.VITE_API_URL ?? 'https://latte.makimura.me'

/** 独自ドメインにする前のサーバーの URL。同じサーバーで、前の版のアプリはここにつないでいる */
const PREVIOUS_SERVER_URL = 'https://michishirube-api.makim0939.workers.dev'

/** この端末がつないでいるサーバーの URL（末尾の / なし） */
function serverOf(config: SyncConfig): string {
  return config.url.replace(/\/+$/, '')
}

/** このアプリのサーバーの URL か（前の版の、合言葉でつないだ接続を見分けるのに使う） */
export function isOurServer(url: string): boolean {
  const normalized = url.replace(/\/+$/, '')
  return normalized === SERVER_URL || normalized === PREVIOUS_SERVER_URL
}

/** Web 版で、Google の画面へ移る前に覚えておく認可（戻ってきたら結果を受け取る） */
const PENDING_KEY = 'michishirube:auth-pending'

export type AuthKind = 'login' | 'youtube'

export type AuthResult = { kind: 'login'; session: string; email?: string } | { kind: 'youtube'; refreshToken: string }

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function sha256(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

async function post(path: string, body: unknown, session?: string): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) },
      body: JSON.stringify(body),
    })
  } catch {
    throw new SyncError(t.errors.offline)
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    if (res.status === 401) throw new SyncError(t.errors.relogin, 401)
    throw new SyncError(
      t.errors.fromServer(typeof json.error === 'string' ? json.error : undefined, typeof json.message === 'string' ? json.message : undefined, res.status),
      res.status,
    )
  }
  return json
}

/** アプリの URL スキーム。Google の画面で認可が終わると、サーバーがこれでアプリへ戻す */
const APP_SCHEME = 'me.makimura.lattecho.app'

type Finish = 'pending' | 'expired' | 'cancelled' | 'failed' | AuthResult

/**
 * 認可の結果を受け取る。始めた端末の合言葉（verifier）と、認可した画面に戻ってきた一度きりのコード（code）の両方が要る
 * （Google の画面へのリンクをほかの人に開かせても、コードはその人の端末に戻るので、結果を横取りできない）
 */
async function finish(id: string, verifier: string, code: string): Promise<Finish> {
  const res = await post('/api/auth/finish', { id, verifier, code })
  const status = res.status
  if (status === 'done') {
    if (res.kind === 'login' && typeof res.session === 'string') {
      return { kind: 'login', session: res.session, email: typeof res.email === 'string' ? res.email : undefined }
    }
    if (res.kind === 'youtube' && typeof res.refreshToken === 'string') return { kind: 'youtube', refreshToken: res.refreshToken }
    return 'failed'
  }
  return status === 'pending' || status === 'expired' || status === 'cancelled' ? status : 'failed'
}

/** 戻ってきた URL から、認可の番号・結果・コードを読む */
function readBack(url: string): { id: string; status: string; code?: string } | null {
  try {
    const params = new URL(url).searchParams
    const id = params.get('auth_id')
    const status = params.get('auth_status')
    if (!id || !status) return null
    return { id, status, code: params.get('auth_code') ?? undefined }
  } catch {
    return null
  }
}

/** アプリの中の Safari で認可画面を開いている（続けて押されても、二重に開かない） */
let sheetOpen = false

/**
 * Google の画面で認可してもらう。
 * - アプリ：アプリの中の Safari で開き、終わったら URL スキームでアプリへ戻ってくる。閉じられたら null
 * - Web 版：画面ごと Google へ移る（戻ってきたら resumeWebAuth で結果を受け取る）。この関数は戻らない
 */
export async function authorizeWithGoogle(kind: AuthKind, session?: string): Promise<AuthResult | null> {
  if (isNativeApp && sheetOpen) return null
  const id = randomString(24)
  const verifier = randomString(48)
  const challenge = await sha256(verifier)
  if (!isNativeApp) {
    const returnTo = window.location.href.split('#')[0].split('?')[0]
    const { url } = (await post('/api/auth/start', { kind, id, challenge, returnTo }, session)) as { url: string }
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ id, verifier }))
    } catch {
      throw new SyncError(t.errors.privateBrowsing)
    }
    window.location.href = url
    return new Promise(() => {})
  }

  const { url } = (await post('/api/auth/start', { kind, id, challenge, app: true, scheme: APP_SCHEME }, session)) as { url: string }
  sheetOpen = true
  let settle: (back: { status: string; code?: string } | null) => void = () => {}
  const returned = new Promise<{ status: string; code?: string } | null>((resolve) => (settle = resolve))
  const opened = await App.addListener('appUrlOpen', ({ url: incoming }) => {
    const back = incoming.startsWith(`${APP_SCHEME}:`) ? readBack(incoming) : null
    if (back && back.id === id) settle(back)
  })
  const closed = await Browser.addListener('browserFinished', () => {
    // 閉じた直後にアプリへ戻ってくることもあるので、少し待ってからあきらめる
    setTimeout(() => settle(null), 1500)
  })
  try {
    await Browser.open({ url, presentationStyle: 'popover' })
    const back = await returned
    await Browser.close().catch(() => {})
    if (!back || back.status !== 'done' || !back.code) return null
    const res = await finish(id, verifier, back.code)
    return typeof res === 'object' ? res : null
  } finally {
    sheetOpen = false
    await opened.remove()
    await closed.remove()
  }
}

/** Web 版で、Google の画面から戻ってきたときに結果を受け取る（URL に付いてきたコードを使い、URL からは消す） */
export async function resumeWebAuth(): Promise<AuthResult | null> {
  const back = readBack(window.location.href)
  if (!back) return null
  // 戻ってきた URL のコードは、1回使ったら消す（履歴や共有に残さない）
  window.history.replaceState(null, '', window.location.href.replace(/\?[^#]*/, ''))
  let pending: { id: string; verifier: string } | null = null
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as { id: string; verifier: string } | null
    localStorage.removeItem(PENDING_KEY)
  } catch {
    // 読めなければ、受け取れない
  }
  if (!pending || pending.id !== back.id) {
    throw new SyncError(t.errors.loginOtherWindow)
  }
  if (back.status !== 'done' || !back.code) return null
  const res = await finish(pending.id, pending.verifier, back.code)
  return typeof res === 'object' ? res : null
}

// ---- ログイン・ログアウト ----

/**
 * この端末の YouTube の鍵を消す。ログアウトしたら、次にこの端末でログインした別の人の動画が、
 * 前の人の YouTube に上がらないように
 */
async function forgetYoutubeKey() {
  await db.meta.delete('youtube:refresh')
}

/** Google でログインしている（前の版の、合言葉でつないだ接続は含まない） */
export function isLoggedIn(config: SyncConfig | undefined): boolean {
  return config?.account === true
}

/**
 * ログインを終えて、同期を始める。
 * 前の版で、同じサーバーに合言葉（APP_TOKEN）でつないでいた端末なら、そのデータをこのアカウントに引き継ぐ
 */
export async function completeLogin(result: Extract<AuthResult, { kind: 'login' }>): Promise<{ firstDevice: boolean }> {
  const previous = await getSyncConfig()
  const config: SyncConfig = { url: SERVER_URL, token: result.session, email: result.email, account: true }
  if (previous && !isLoggedIn(previous) && isOurServer(previous.url)) {
    await fetch(`${SERVER_URL}/api/account/claim-legacy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'X-Legacy-Token': previous.token },
    }).catch(() => {})
  }
  return connectWithConfig(config)
}

/** Google でログインする（アプリ：アプリの中の Safari、Web 版：画面ごと移る） */
export async function loginWithGoogle(): Promise<{ firstDevice: boolean } | null> {
  const result = await authorizeWithGoogle('login')
  return result?.kind === 'login' ? completeLogin(result) : null
}

/** Sign in with Apple の画面を出すプラグイン（iOS の SignInWithApplePlugin.swift。外部のプラグインは Capacitor 8 に対応していないため、アプリの中に作っている） */
interface SignInWithApplePlugin {
  authorize(options: { nonce: string }): Promise<{ response: { identityToken: string; authorizationCode?: string | null; email: string | null } }>
}
const SignInWithApple = registerPlugin<SignInWithApplePlugin>('SignInWithApple')

/** Apple の画面を閉じたときの取り消しか（エラーの番号は 1001。ほかの失敗とは分けて、エラーにしない） */
export function isAppleCancelled(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '1001'
}

/** nonce（使い捨ての値）。Apple には、その SHA-256 を渡し、サーバーには元の値を送って、照らし合わせてもらう */
function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Sign in with Apple でログインする（iOS アプリだけ。Google と同じ働きで、同じ記録を使える）。
 * Apple の画面で認可してもらい、受け取った ID トークンをサーバーで確かめてもらう。取り消したときは null
 */
export async function loginWithApple(): Promise<{ firstDevice: boolean } | null> {
  const nonce = randomNonce()
  let identityToken: string
  let authorizationCode: string | null | undefined
  let appleEmail: string | null
  try {
    const { response } = await SignInWithApple.authorize({ nonce: await sha256Hex(nonce) })
    identityToken = response.identityToken
    authorizationCode = response.authorizationCode
    appleEmail = response.email
  } catch (e) {
    // 途中で閉じたときは、エラーにしない（Apple の画面の取り消し。エラーの番号は 1001）
    if (isAppleCancelled(e)) return null
    // どこで失敗したかが分かるよう、Apple の認証の段階の理由をそのまま出す
    throw new SyncError(t.errors.apple(e instanceof Error ? e.message : String(e)))
  }
  let res: Response
  try {
    res = await fetch(`${SERVER_URL}/api/auth/apple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken, nonce, ...(authorizationCode ? { authorizationCode } : {}) }),
    })
  } catch {
    throw new SyncError(t.errors.offline)
  }
  if (!res.ok) {
    // サーバーが確かめられなかった理由（トークンの不正・Apple の鍵の取得失敗など）を出す
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new SyncError(t.errors.verifyFailed(res.status, body.message), res.status)
  }
  const { session, email } = (await res.json()) as { session: string; email?: string }
  return completeLogin({ kind: 'login', session, email: email ?? appleEmail ?? undefined })
}

/** つながりを切り、この端末の YouTube の鍵を消す（写真をサーバーに置いた印は、次にログインしたときに見直す） */
async function forgetConnection() {
  await disconnectSync()
  await forgetYoutubeKey()
}

/** この端末のログインを終える。端末の記録はそのまま残る */
export async function logout() {
  const config = await getSyncConfig()
  if (config) {
    // ログインした端末がつないでいるサーバー（独自ドメインにする前にログインした端末は、前の URL）に送る
    // 電波が悪くても、ログアウト（とすべて削除）が止まらないよう、長くは待たない
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 5000)
    await fetch(`${serverOf(config)}/api/session`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.token}` },
      signal: abort.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(timer))
  }
  await forgetConnection()
}

/**
 * アカウントと、サーバーに置いたデータをすべて消す。端末の記録はそのまま残る。
 * ログインが切れていた（ほかの端末で削除した・長く使わなかった）ときは、消せたか分からないので false を返す（この端末のログインは終える）
 */
export async function deleteAccount(): Promise<boolean> {
  const config = await getSyncConfig()
  if (!config) return false
  let res: Response
  try {
    res = await fetch(`${serverOf(config)}/api/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${config.token}` } })
  } catch {
    throw new SyncError(t.errors.offline)
  }
  if (!res.ok && res.status !== 401) throw new SyncError(t.errors.deleteFailed(res.status), res.status)
  await forgetConnection()
  if (!res.ok) return false
  // サーバーの写真は消えたので、置いた印も消す（消せたか分からないときは残す。同じアカウントに戻れば、そのまま取ってこられる）
  await db.media.toCollection().modify((m) => {
    delete m.cloudPhoto
    delete m.cloudPoster
    delete m.cloudPosterEnd
  })
  return true
}

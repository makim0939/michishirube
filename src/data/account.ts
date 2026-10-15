import { Browser } from '@capacitor/browser'
import { isNativeApp } from '../platform'
import { db } from './db'
import { connectWithConfig, disconnectSync, getSyncConfig, SyncError, type SyncConfig } from './sync'

/**
 * Google でログインして、記録・写真をサーバーに置く（ほかの端末でも同じ記録を使える）。
 * サーバーに置くのは、記録・型・分野・動画と写真の情報・設定・縮小した写真・動画のサムネイルだけ。
 * 動画の中身と YouTube の鍵はサーバーに置かない
 */

/** みんなで使うサーバー */
export const SERVER_URL: string = import.meta.env.VITE_API_URL ?? 'https://michishirube-api.makim0939.workers.dev'

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
    throw new SyncError('サーバーにつながりません。電波を確認してください')
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    if (res.status === 401) throw new SyncError('ログインし直してください', 401)
    throw new SyncError(typeof json.message === 'string' ? json.message : `サーバーでエラーが起きました（${res.status}）`, res.status)
  }
  return json
}

type Finish = 'pending' | 'expired' | 'cancelled' | 'failed' | AuthResult

/** 認可の結果を問い合わせる。合言葉（verifier）を知っているこのアプリだけが受け取れる */
async function finish(id: string, verifier: string): Promise<Finish> {
  const res = await post('/api/auth/finish', { id, verifier })
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

/** アプリの中の Safari で認可画面を開いている（続けて押されても、二重に開かない） */
let sheetOpen = false

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Google の画面で認可してもらう。
 * - アプリ：アプリの中の Safari で開き、終わったかをサーバーに問い合わせて、終わったら自分で閉じる。閉じられたら null
 * - Web 版：画面ごと Google へ移る（戻ってきたら resumeWebAuth で結果を受け取る）。この関数は戻らない
 */
export async function authorizeWithGoogle(kind: AuthKind, session?: string): Promise<AuthResult | null> {
  if (isNativeApp && sheetOpen) return null
  const id = randomString(24)
  const verifier = randomString(48)
  const returnTo = isNativeApp ? undefined : window.location.href.split('#')[0]
  const { url } = (await post('/api/auth/start', { kind, id, challenge: await sha256(verifier), returnTo }, session)) as {
    url: string
  }
  if (!isNativeApp) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ id, verifier }))
    } catch {
      throw new SyncError('この画面ではログインできません（プライベートブラウズでは使えません）')
    }
    window.location.href = url
    return new Promise(() => {})
  }

  sheetOpen = true
  let closed = false
  const listener = await Browser.addListener('browserFinished', () => {
    closed = true
  })
  try {
    await Browser.open({ url, presentationStyle: 'popover' })
    // 10分まで、少しずつ問い合わせる。閉じられたら、最後にもう一度だけ確かめてやめる
    const until = Date.now() + 10 * 60 * 1000
    while (Date.now() < until) {
      await sleep(1500)
      const wasClosed = closed
      const res = await finish(id, verifier).catch(() => 'pending' as const)
      if (typeof res === 'object') {
        if (!closed) await Browser.close().catch(() => {})
        return res
      }
      if (res !== 'pending' || wasClosed) {
        if (!closed) await Browser.close().catch(() => {})
        return null
      }
    }
    await Browser.close().catch(() => {})
    return null
  } finally {
    sheetOpen = false
    await listener.remove()
  }
}

/** Web 版で、Google の画面から戻ってきたときに結果を受け取る。まだなら 'pending' */
export async function resumeWebAuth(): Promise<AuthResult | 'pending' | null> {
  let pending: { id: string; verifier: string } | null = null
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as { id: string; verifier: string } | null
  } catch {
    return null
  }
  if (!pending) return null
  const res = await finish(pending.id, pending.verifier)
  if (res === 'pending') return 'pending'
  localStorage.removeItem(PENDING_KEY)
  return typeof res === 'object' ? res : null
}

// ---- ログイン・ログアウト ----

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
  if (previous && !isLoggedIn(previous) && previous.url.replace(/\/+$/, '') === SERVER_URL) {
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

/** この端末のログインを終える。端末の記録はそのまま残る */
export async function logout() {
  const config = await getSyncConfig()
  if (config) {
    await fetch(`${SERVER_URL}/api/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${config.token}` } }).catch(
      () => {},
    )
  }
  await disconnectSync()
}

/** アカウントと、サーバーに置いたデータをすべて消す。端末の記録はそのまま残る */
export async function deleteAccount() {
  const config = await getSyncConfig()
  if (!config) return
  let res: Response
  try {
    res = await fetch(`${SERVER_URL}/api/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${config.token}` } })
  } catch {
    throw new SyncError('サーバーにつながりません。電波を確認してください')
  }
  if (!res.ok && res.status !== 401) throw new SyncError(`削除できませんでした（${res.status}）`, res.status)
  await disconnectSync()
  // 写真をサーバーに置いた印も消す（次にログインしたら置き直す）
  await db.media.toCollection().modify((m) => {
    delete m.cloudPhoto
    delete m.cloudPoster
    delete m.cloudPosterEnd
  })
}

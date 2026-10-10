import { liveQuery } from 'dexie'
import { formatDateTime } from '../domain/format'
import type { Media, Outcome } from '../domain/types'
import { db, markDirty } from './db'
import { api, getSyncConfig, SyncError, type SyncConfig } from './sync'

/**
 * 動画を YouTube に「非公開」で上げる。
 * access token はサーバーから1時間だけ使えるものをもらい、動画はアプリから YouTube へ直接送る。
 */

export interface YoutubeStatus {
  configured: boolean
  connected: boolean
}

const PAUSE_KEY = 'youtube:pausedUntil'
/** 続けてこの回数失敗したら、自動では上げ直さない（壊れた動画を何度も送らないように） */
export const MAX_UPLOAD_ATTEMPTS = 3
const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType='
const OUTCOME_LABEL: Record<Outcome, string> = { good: '◎ 成功', meh: '△ 惜しい', bad: '✕ 失敗' }

export async function youtubeStatus(): Promise<YoutubeStatus | undefined> {
  const config = await getSyncConfig()
  if (!config) return undefined
  return (await (await api(config, '/api/youtube/status')).json()) as YoutubeStatus
}

/** Google の画面へ移動して連携する。終わるとサーバーがアプリの設定画面へ戻す */
export async function startYoutubeAuth() {
  const config = await requireConfig()
  const returnTo = window.location.href.split('#')[0]
  const { url } = (await (
    await api(config, '/api/youtube/auth-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnTo }),
    })
  ).json()) as { url: string }
  window.location.href = url
}

export async function disconnectYoutube() {
  await api(await requireConfig(), '/api/youtube', { method: 'DELETE' })
}

async function requireConfig(): Promise<SyncConfig> {
  const config = await getSyncConfig()
  if (!config) throw new SyncError('先にクラウド同期を設定してください')
  return config
}

// ---- アップロード ----

let token: { value: string; expiresAt: number } | undefined

async function accessToken(config: SyncConfig): Promise<string> {
  if (token && token.expiresAt - Date.now() > 60_000) return token.value
  const res = (await (await api(config, '/api/youtube/token', { method: 'POST' })).json()) as {
    accessToken: string
    expiresAt: number
  }
  token = { value: res.accessToken, expiresAt: res.expiresAt }
  return token.value
}

export interface VideoMeta {
  title: string
  description: string
}

/** YouTube に付けるタイトルと説明。あとで YouTube 側で見ても、どの練習か分かるようにする */
export async function videoMeta(media: Media): Promise<VideoMeta> {
  const [record, skill] = await Promise.all([db.records.get(media.recordId), db.skills.get(media.skillId)])
  const domain = skill ? await db.domains.get(skill.domainId) : undefined
  const title = [domain?.name, skill?.name, formatDateTime(media.createdAt)].filter(Boolean).join('｜')
  const lines: string[] = []
  if (record?.outcome) lines.push(OUTCOME_LABEL[record.outcome])
  if (record?.reason) lines.push(`なぜ：${record.reason}`)
  if (record?.nextAction) lines.push(`次の一手：${record.nextAction}`)
  lines.push('', 'ラテリエで記録')
  // YouTube のタイトルは100文字まで
  return { title: title.slice(0, 100), description: lines.join('\n').slice(0, 4900) }
}

export class QuotaExceeded extends Error {}

/**
 * 1本を上げて、YouTube の動画 ID を返す。
 * 再開可能アップロードを使い、アップロード先（Location ヘッダー）を読めない環境では、1回で送る方式にする
 */
export async function uploadVideo(
  blob: Blob,
  meta: VideoMeta,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const contentType = blob.type || 'video/mp4'
  const resource = JSON.stringify({
    snippet: { title: meta.title, description: meta.description, categoryId: '26' },
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
  })
  const auth = { Authorization: `Bearer ${accessToken}` }
  const start = await fetchImpl(`${UPLOAD_BASE}resumable`, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': contentType,
      'X-Upload-Content-Length': String(blob.size),
    },
    body: resource,
  })
  await throwIfFailed(start)
  const location = start.headers.get('Location')
  let done: Response
  if (location) {
    done = await fetchImpl(location, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob })
  } else {
    const boundary = `michishirube-${Math.random().toString(36).slice(2)}`
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${resource}\r\n`,
      `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ])
    done = await fetchImpl(`${UPLOAD_BASE}multipart`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
  }
  await throwIfFailed(done)
  const video = (await done.json()) as { id?: string }
  if (!video.id) throw new Error('YouTube から動画 ID を受け取れませんでした')
  return video.id
}

async function throwIfFailed(res: Response) {
  if (res.ok) return
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; errors?: { reason?: string }[] }
  }
  const reason = body.error?.errors?.[0]?.reason
  if (res.status === 403 && (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded')) {
    throw new QuotaExceeded('今日アップロードできる上限に達しました')
  }
  if (res.status === 401) token = undefined
  throw new Error(body.error?.message ?? `YouTube でエラーが起きました（${res.status}）`)
}

async function setUpload(id: string, patch: Partial<Media>) {
  await db.transaction('rw', db.media, db.outbox, async () => {
    await db.media.update(id, { ...patch, updatedAt: Date.now() })
    await markDirty('media', [id])
  })
}

let running: Promise<void> | null = null
/** 連携していない・サーバーに設定が無いときは、しばらく試さない（書き込みのたびに問い合わせないように） */
let blockedUntil = 0

/** 連携し直したときなどに、すぐ再開できるようにする */
export function resumeUploads() {
  blockedUntil = 0
  token = undefined
  return runUploads()
}

/** 上げていない動画を順に上げる。同時に1つだけ動かす */
export function runUploads(): Promise<void> {
  running ??= doUploads().finally(() => {
    running = null
  })
  return running
}

async function doUploads() {
  const config = await getSyncConfig()
  if (!config || Date.now() < blockedUntil) return
  const paused = (await db.meta.get(PAUSE_KEY))?.value as number | undefined
  if (paused && paused > Date.now()) return
  const tried = new Set<string>()
  // 上げている間に撮った動画も、続けて上げる。失敗したものは、次に動いたときに上げ直す
  for (;;) {
    const targets = (
      await db.media
        .where('upload')
        .anyOf('pending', 'uploading', 'failed')
        .filter((m) => !!m.blob && (m.upload !== 'failed' || (m.uploadAttempts ?? 0) < MAX_UPLOAD_ATTEMPTS))
        .sortBy('createdAt')
    ).filter((m) => !tried.has(m.id))
    if (targets.length === 0) return
    for (const m of targets) {
      tried.add(m.id)
      try {
        const tokenValue = await accessToken(config)
        await db.media.update(m.id, { upload: 'uploading' })
        const youtubeId = await uploadVideo(m.blob!, await videoMeta(m), tokenValue)
        await setUpload(m.id, { upload: 'done', youtubeId, uploadError: undefined, uploadAttempts: undefined })
      } catch (e) {
        if (e instanceof SyncError && (e.status === 409 || e.status === 400)) {
          // 連携していない・切れた・サーバーに Google の設定が無い：上げずに待つ（設定画面で連携すると再開する）
          blockedUntil = Date.now() + 10 * 60 * 1000
          if (m.upload === 'uploading') await db.media.update(m.id, { upload: 'pending' })
          return
        }
        if (e instanceof QuotaExceeded) {
          // 上限は太平洋時間の0時に戻るので、半日おいて再開する
          await db.meta.put({ key: PAUSE_KEY, value: Date.now() + 12 * 60 * 60 * 1000 })
          await setUpload(m.id, { upload: 'pending', uploadError: e.message })
          return
        }
        if (e instanceof SyncError || e instanceof TypeError) {
          // 電波が無い・アプリが裏に回って通信が切れたなど。失敗にはせず、次の機会に上げる
          await db.media.update(m.id, { upload: 'pending' })
          return
        }
        await setUpload(m.id, {
          upload: 'failed',
          uploadError: e instanceof Error ? e.message : String(e),
          uploadAttempts: (m.uploadAttempts ?? 0) + 1,
        })
      }
    }
  }
}

/** 自動で上げ直すのをやめた動画を、もう一度上げる */
export async function retryUpload(id: string) {
  await setUpload(id, { upload: 'pending', uploadError: undefined, uploadAttempts: 0 })
  return resumeUploads()
}

/** 上げる動画ができたら上げる。画面に戻ったとき・電波が戻ったときにも試す */
export function startAutoUpload(): () => void {
  const kick = () => {
    runUploads().catch(() => {
      // 失敗は各動画の uploadError に残っている
    })
  }
  // 上げる動画が増えたときだけ動かす（状態の書き込みのたびに動かない）
  let last = 0
  const sub = liveQuery(() => db.media.where('upload').equals('pending').count()).subscribe((n) => {
    if (n > last) kick()
    last = n
  })
  const onVisible = () => {
    if (document.visibilityState === 'visible') kick()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', kick)
  return () => {
    sub.unsubscribe()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', kick)
  }
}

export function youtubeUrl(id: string): string {
  return `https://youtu.be/${encodeURIComponent(id)}`
}

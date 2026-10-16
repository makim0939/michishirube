import { liveQuery } from 'dexie'
import { formatDateTime, OUTCOME_LABEL } from '../domain/format'
import type { Media } from '../domain/types'
import { ContentUnavailableError, contentBlob, hasContent } from './content'
import { usesFiles } from './files'
import { db, markDirty, mediaByIndex } from './db'
import { authorizeWithGoogle } from './account'
import { api, getSyncConfig, SyncError, type SyncConfig } from './sync'
import { SITE_URL } from '../platform'
import { getVideoSettings, getVideoStorage, type YoutubePrivacy } from './videoStorage'

/**
 * 動画を YouTube に上げる（公開範囲は設定から。はじめは限定公開）。上げるのは、動画の保存先が YouTube の端末だけ。
 * YouTube の鍵はこの端末にだけ置き、上げる前にサーバーで1時間だけ使える access token に替えてもらう。
 * 動画はアプリから YouTube へ直接送る（サーバーを通さない）
 */

export interface YoutubeStatus {
  /** サーバーに Google の設定がある */
  configured: boolean
  /** この端末が YouTube と連携している（YouTube の鍵をこの端末に持っている） */
  connected: boolean
}

const PAUSE_KEY = 'youtube:pausedUntil'
/** YouTube の鍵（refresh token）。この端末にだけ置き、サーバーには置かない（同期・バックアップにも入れない） */
const REFRESH_KEY = 'youtube:refresh'
/** 続けてこの回数失敗したら、自動では上げ直さない（壊れた動画を何度も送らないように） */
export const MAX_UPLOAD_ATTEMPTS = 3
const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType='

async function refreshToken(): Promise<string | undefined> {
  return (await db.meta.get(REFRESH_KEY))?.value as string | undefined
}

/** この端末が YouTube と連携している（鍵を持っている）か。通信しないので、画面の表示に使える */
export async function isYoutubeConnected(): Promise<boolean> {
  return !!(await refreshToken())
}

/** ログインしていなければ undefined */
export async function youtubeStatus(): Promise<YoutubeStatus | undefined> {
  const config = await getSyncConfig()
  if (!config) return undefined
  const { configured } = (await (await api(config, '/api/youtube/status')).json()) as { configured: boolean }
  return { configured, connected: !!(await refreshToken()) }
}

/**
 * YouTube と連携する（Google の画面で、YouTube へのアップロードを許可してもらう）。
 * 受け取った鍵はこの端末にだけ置く。ほかの端末では、その端末で連携し直す。連携したら true
 */
export async function connectYoutube(): Promise<boolean> {
  const config = await requireConfig()
  const result = await authorizeWithGoogle('youtube', config.token)
  if (result?.kind !== 'youtube') return false
  await saveYoutubeKey(result.refreshToken)
  return true
}

/** 受け取った YouTube の鍵を置き、止めていたアップロードを再開する */
export async function saveYoutubeKey(refresh: string) {
  await db.meta.put({ key: REFRESH_KEY, value: refresh })
  token = undefined
  void resumeUploads().catch(() => {})
}

/** 連携を解除する（Google 側の許可も取り消し、この端末の鍵を消す） */
export async function disconnectYoutube() {
  const refresh = await refreshToken()
  const config = await getSyncConfig()
  if (refresh && config) {
    await api(config, '/api/youtube/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => {})
  }
  await db.meta.delete(REFRESH_KEY)
  token = undefined
}

async function requireConfig(): Promise<SyncConfig> {
  const config = await getSyncConfig()
  if (!config) throw new SyncError('先に Google でログインしてください')
  return config
}

// ---- アップロード ----

/** 替えてもらった access token と、その元の鍵（ログアウト・別の人が連携し直したら、前の人のものを使わない） */
let token: { value: string; expiresAt: number; refresh: string } | undefined

/** アップロード用の access token。この端末の鍵をサーバーに渡し、1時間だけ使えるものに替えてもらう */
async function accessToken(config: SyncConfig): Promise<string> {
  const refresh = await refreshToken()
  if (!refresh) throw new SyncError('YouTube と連携していません', 409)
  if (token && token.refresh === refresh && token.expiresAt - Date.now() > 60_000) return token.value
  let res: { accessToken: string; expiresAt: number }
  try {
    res = (await (
      await api(config, '/api/youtube/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      })
    ).json()) as { accessToken: string; expiresAt: number }
  } catch (e) {
    // 連携が取り消された・期限切れなら、鍵を消して連携し直してもらう
    if (e instanceof SyncError && e.status === 409) await db.meta.delete(REFRESH_KEY)
    throw e
  }
  token = { value: res.accessToken, expiresAt: res.expiresAt, refresh }
  return token.value
}

export interface VideoMeta {
  title: string
  description: string
  /** 公開範囲。省くと限定公開 */
  privacy?: YoutubePrivacy
}

/** YouTube に付けるタイトルと説明。あとで YouTube 側で見ても、どの練習か分かるようにする */
export async function videoMeta(media: Media): Promise<VideoMeta> {
  const [record, skill, settings] = await Promise.all([
    db.records.get(media.recordId),
    db.skills.get(media.skillId),
    getVideoSettings(),
  ])
  const domain = skill ? await db.domains.get(skill.domainId) : undefined
  const title = [domain?.name, skill?.name, formatDateTime(media.createdAt)].filter(Boolean).join('｜')
  const lines: string[] = []
  if (record?.outcome) lines.push(OUTCOME_LABEL[record.outcome])
  if (record?.causes?.length) lines.push(`原因：${record.causes.join('・')}`)
  if (record?.reason) lines.push(`メモ：${record.reason}`)
  if (record?.nextAction) lines.push(`次の一手：${record.nextAction}`)
  // 説明欄のリンクから、アプリの紹介ページに来てもらう
  lines.push('', 'ラテ帳で記録', SITE_URL)
  // YouTube のタイトルは100文字まで
  return {
    title: title.slice(0, 100),
    description: lines.join('\n').slice(0, 4900),
    privacy: media.youtubePrivacy ?? settings.youtubePrivacy,
  }
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
    status: { privacyStatus: meta.privacy ?? 'unlisted', embeddable: true, selfDeclaredMadeForKids: false },
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

/**
 * 上げた結果を書く。contentAt を渡したら、上げているあいだに中身が差し替わった（切り取ったなど）ときは書かない
 * （差し替えた中身は、アップ待ちのまま次に上げる）
 */
async function setUpload(id: string, patch: Partial<Media>, contentAt?: number) {
  await db.transaction('rw', db.media, db.outbox, async () => {
    if (contentAt !== undefined && ((await db.media.get(id))?.contentAt ?? 0) !== contentAt) return
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
  // 保存先が端末なら上げない（アップ待ちのまま残し、YouTube に切り替えたら上げる）
  if ((await getVideoStorage()) !== 'youtube') return
  const paused = (await db.meta.get(PAUSE_KEY))?.value as number | undefined
  if (paused && paused > Date.now()) return
  const tried = new Set<string>()
  // 上げている間に撮った動画も、続けて上げる。失敗したものは、次に動いたときに上げ直す
  for (;;) {
    const targets = (await mediaByIndex(db.media.where('upload').anyOf('pending', 'uploading', 'failed')))
      .filter((m) => readyToUpload(m) && (m.upload !== 'failed' || (m.uploadAttempts ?? 0) < MAX_UPLOAD_ATTEMPTS))
      .filter((m) => !tried.has(m.id))
      .sort((a, b) => a.createdAt - b.createdAt)
    if (targets.length === 0) return
    for (const m of targets) {
      // 途中で保存先を端末に切り替えたら、残りは上げない
      if ((await getVideoStorage()) !== 'youtube') return
      tried.add(m.id)
      try {
        const tokenValue = await accessToken(config)
        await db.media.update(m.id, { upload: 'uploading' })
        // ファイルが無いときは「失敗」にする（電波の失敗と分け、ほかの動画を先に上げる）
        const content = await contentBlob(m)
        if (!content) throw new ContentUnavailableError()
        const youtubeId = await uploadVideo(content, await videoMeta(m), tokenValue)
        await setUpload(m.id, { upload: 'done', youtubeId, uploadError: undefined, uploadAttempts: undefined }, m.contentAt ?? 0)
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
          await setUpload(m.id, { upload: 'pending', uploadError: e.message }, m.contentAt ?? 0)
          return
        }
        if (e instanceof SyncError || e instanceof TypeError) {
          // 電波が無い・アプリが裏に回って通信が切れたなど。失敗にはせず、次の機会に上げる
          await db.media.update(m.id, { upload: 'pending' })
          return
        }
        await setUpload(
          m.id,
          {
            upload: 'failed',
            uploadError: e instanceof Error ? e.message : String(e),
            uploadAttempts: (m.uploadAttempts ?? 0) + 1,
          },
          m.contentAt ?? 0,
        )
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
/**
 * 上げられる状態か。アプリでは、ファイルに移して画質をそろえ終えてから上げる
 * （アルバムの大きな動画を、そのまま長い時間かけて上げないように）
 */
function readyToUpload(m: Media): boolean {
  if (!hasContent(m)) return false
  return !usesFiles || (!!m.file && !!m.optimized)
}

export function startAutoUpload(): () => void {
  const kick = () => {
    runUploads().catch(() => {
      // 失敗は各動画の uploadError に残っている
    })
  }
  // 上げる動画が増えたときだけ動かす（状態の書き込みのたびに動かない）
  let last = 0
  const sub = liveQuery(() => db.media.where('upload').equals('pending').filter(readyToUpload).count()).subscribe((n) => {
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

/**
 * YouTube の動画を、アプリの中で再生できるか（限定公開・公開で、処理が終わっているか）。
 * oEmbed は、再生できない動画（非公開・処理の失敗・削除）には 401・404 などを返す。
 * 電波が無いなどで確かめられなければ false
 */
export async function youtubePlayable(id: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeUrl(id))}`)
    return res.ok
  } catch {
    return false
  }
}

/**
 * YouTube のサムネイル。この端末にサムネイルが無い動画に使う（動画の途中のコマ）。
 * 縦の動画は左右に帯が付いた4:3の絵なので、正方形の枠いっぱいに広げると、全体が収まって見える
 */
export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`
}

export function youtubeUrl(id: string): string {
  return `https://youtu.be/${encodeURIComponent(id)}`
}

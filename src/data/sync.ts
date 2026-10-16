import { liveQuery } from 'dexie'
import type { EntityChange, EntityKind, SyncResponse } from '../../shared/protocol'
import { PHOTO_MAX_BYTES, posterPhotoId, SYNC_LIMITS } from '../../shared/protocol'
import { DEFAULT_SETTINGS, type Media, type Settings } from '../domain/types'
import { ContentUnavailableError, contentBlob, hasContent, moveContentsToFiles } from './content'
import { db } from './db'
import { listContentFiles, usesFiles } from './files'

/**
 * サーバー（Cloudflare Worker + D1）との同期。Google でログインした人のデータだけをやり取りする（account.ts）。
 * 画面はいつも端末の IndexedDB を読み書きし、変更は outbox にためてまとめて送る。
 * 同じものが両方で変わっていたら、updatedAt が新しいほうを残す。
 */

export interface SyncConfig {
  /** Worker の URL（例: https://michishirube-api.xxx.workers.dev） */
  url: string
  /** ログインしたときにもらったトークン（前の版では、サーバーの合言葉 APP_TOKEN） */
  token: string
  /** Google でログインした（前の版の、合言葉でつないだ接続なら無い） */
  account?: boolean
  /** ログインした Google アカウント（表示するだけ。サーバーには置いていない） */
  email?: string
}

export interface SyncStatus {
  lastSyncedAt?: number
  error?: string
  /** サーバーに置ける写真の量を超えて、置けていない写真がある */
  photosFull?: boolean
  /** 大きすぎて送れない記録・型の数 */
  tooLarge?: number
}

const CONFIG_KEY = 'sync:config'
const CURSOR_KEY = 'sync:cursor'
const STATUS_KEY = 'sync:status'
/** 写真の置ける量を超えた時刻。しばらくは写真を送らない（断られる写真を、同期のたびに送り直さないように） */
const PHOTOS_FULL_KEY = 'sync:photos-full'
const PHOTOS_FULL_RETRY_MS = 24 * 60 * 60 * 1000
/**
 * ログインし直したあと、写真・サムネイルをサーバーに置いた印を見直す（前に別のアカウントでつないでいたかもしれない）。
 * サーバーの内容を受け取りきってから見直す（先に置くと、ほかの端末で差し替えた写真を、この端末の古い写真で上書きしてしまう）
 */
const RECHECK_PHOTOS_KEY = 'sync:recheck-photos'

export class SyncError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export async function getSyncConfig(): Promise<SyncConfig | undefined> {
  return (await db.meta.get(CONFIG_KEY))?.value as SyncConfig | undefined
}

/** 始めたときと同じログインのままか（ログアウトしたら、ログインし直していても、前の同期は続けない） */
async function stillConnected(config: SyncConfig): Promise<boolean> {
  return (await getSyncConfig())?.token === config.token
}

async function setStatus(status: SyncStatus) {
  await db.meta.put({ key: STATUS_KEY, value: status })
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return ((await db.meta.get(STATUS_KEY))?.value as SyncStatus | undefined) ?? {}
}

export async function api(config: SyncConfig, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${config.url.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.token}`, ...(init.headers ?? {}) },
    })
  } catch {
    throw new SyncError('サーバーにつながりません。電波か URL を確認してください')
  }
  if (res.status === 401) throw new SyncError('ログインし直してください', 401)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    throw new SyncError(body.message ?? body.error ?? `サーバーでエラーが起きました（${res.status}）`, res.status)
  }
  return res
}

// ---- 端末の行 ⇄ 送る形 ----

const TABLES = {
  domain: () => db.domains,
  skill: () => db.skills,
  record: () => db.records,
  media: () => db.media,
} as const

async function readLocal(kind: EntityKind, id: string): Promise<{ updatedAt: number } | undefined> {
  if (kind === 'settings') {
    // 一度も変えていなければ既定値（updatedAt 0）として扱い、削除として送らない
    const value = (await db.meta.get('settings'))?.value as Partial<Settings> | undefined
    return { ...DEFAULT_SETTINGS, ...value, updatedAt: value?.updatedAt ?? 0 }
  }
  return (await TABLES[kind]().get(id)) as { updatedAt: number } | undefined
}

function toWire(kind: EntityKind, row: Record<string, unknown>): Record<string, unknown> {
  if (kind !== 'media') return row
  // 動画・写真の中身（とアプリのファイルの場所）とサムネイルは送らない（動画は YouTube、写真とサムネイルは別の API）
  const {
    blob: _blob,
    file: _file,
    optimized: _optimized,
    optimizeTries: _optimizeTries,
    poster: _poster,
    posterEnd: _posterEnd,
    ...rest
  } = row
  return rest
}

/** 中身（動画・写真）とそれに付いた結果。中身を差し替えた端末の値を、まとめて残す */
const CONTENT_KEYS = [
  'type',
  'name',
  'size',
  'upload',
  'uploadError',
  'uploadAttempts',
  'youtubeId',
  'cloudPhoto',
  'cloudPoster',
  'cloudPosterEnd',
  'contentAt',
] as const

/**
 * サーバーから来た動画・写真の行を、端末の行と合わせる。
 * - 端末のほうが新しい中身（切り取ったなど）を持っていれば、中身まわりは端末の値を残して送り直す
 * - サーバーのほうが新しい中身なら、端末の古い中身・サムネイルは捨てる（取り直す）
 * - 同じ中身なら、上げた結果（YouTube・写真・サムネイル）は上げた端末だけが書くので、
 *   別の端末の古い行（まだ結果を知らない）で消されたら、端末の結果を残して送り直す（同じ動画を二重に上げないため）
 */
function mergeMedia(remote: Media, local: Media | undefined): { row: Media; repaired: boolean } {
  const row: Media = { ...remote }
  if (!local) return { row, repaired: false }
  const remoteAt = remote.contentAt ?? 0
  const localAt = local.contentAt ?? 0
  if (remoteAt > localAt) return { row, repaired: false }
  if (local.blob) row.blob = local.blob
  // アプリでは中身がファイルにある。行を置き換えても、ファイルの場所を失わないようにする
  if (local.file) {
    row.file = local.file
    if (local.optimized) row.optimized = local.optimized
    if (local.optimizeTries) row.optimizeTries = local.optimizeTries
  }
  if (local.poster) {
    row.poster = local.poster
    row.posterEnd = local.posterEnd
  }
  if (localAt > remoteAt) {
    const fields = row as unknown as Record<string, unknown>
    for (const key of CONTENT_KEYS) fields[key] = local[key]
    row.updatedAt = Date.now()
    return { row, repaired: true }
  }
  let repaired = false
  if (local.youtubeId && !remote.youtubeId) {
    row.youtubeId = local.youtubeId
    row.upload = 'done'
    delete row.uploadError
    repaired = true
  }
  if (local.cloudPhoto && !remote.cloudPhoto) {
    row.cloudPhoto = true
    repaired = true
  }
  if (local.cloudPoster && !remote.cloudPoster) {
    row.cloudPoster = true
    repaired = true
  }
  if (local.cloudPosterEnd && !remote.cloudPosterEnd) {
    row.cloudPosterEnd = true
    repaired = true
  }
  if (repaired) row.updatedAt = Date.now()
  return { row, repaired }
}

/** サーバーから来た変更を端末に反映する。端末のほうが新しければ何もしない */
export async function applyRemote(changes: EntityChange[]) {
  await db.transaction('rw', [db.domains, db.skills, db.records, db.media, db.meta, db.outbox], async () => {
    for (const c of changes) {
      const local = await readLocal(c.kind, c.id)
      if (local && local.updatedAt >= c.updatedAt) continue
      if (c.kind === 'settings') {
        if (!c.deleted) await db.meta.put({ key: 'settings', value: { ...c.data, updatedAt: c.updatedAt } })
        continue
      }
      const table = TABLES[c.kind]()
      if (c.deleted) {
        await table.delete(c.id)
        continue
      }
      const row = { ...c.data, id: c.id, updatedAt: c.updatedAt } as Record<string, unknown>
      if (c.kind === 'media') {
        const merged = mergeMedia(row as unknown as Media, local as Media | undefined)
        await db.media.put(merged.row)
        if (merged.repaired) await db.outbox.put({ kind: 'media', id: c.id, at: Date.now() })
        continue
      }
      await (table as typeof db.domains).put(row as never)
    }
  })
}

// ---- 同期の本体 ----

let running: Promise<void> | null = null

/** outbox を送り、サーバーの変更を受け取る。同時に1つだけ動かす */
export function runSync(): Promise<void> {
  running ??= doSync().finally(() => {
    running = null
  })
  return running
}

async function doSync(): Promise<void> {
  const config = await getSyncConfig()
  if (!config) return
  const recheck = !!(await db.meta.get(RECHECK_PHOTOS_KEY))
  // 見直す前の印は、前のアカウントのものかもしれない。中身のある写真・サムネイルの印は送らない（見直して置けたら送る）
  const readable = recheck ? await readableContent() : undefined
  try {
    if (!recheck) {
      await uploadPhotos(config)
      await uploadPosters(config)
    }
    // 送りきるまで、または受け取りきるまで繰り返す（上限つき）
    let tooLarge = 0
    for (let round = 0; round < 50; round++) {
      // 同期の途中でログアウト・すべて削除したら、受け取ったものを書き戻さずにやめる
      if (!(await stillConnected(config))) return
      const since = ((await db.meta.get(CURSOR_KEY))?.value as number | undefined) ?? 0
      const outbox = await db.outbox.limit(SYNC_LIMITS.maxChanges).toArray()
      const changes: EntityChange[] = []
      const sent: typeof outbox = []
      for (const entry of outbox) {
        const local = await readLocal(entry.kind, entry.id)
        if (local) {
          const data = toWire(entry.kind, local as Record<string, unknown>)
          if (readable && entry.kind === 'media') {
            if (readable(local as Media)) delete data.cloudPhoto
            if ((local as Media).poster) {
              delete data.cloudPoster
              delete data.cloudPosterEnd
            }
          }
          // サーバーが受け付けない大きさのもの（とても長いメモなど）は送らない。送ると全体が断られ、ほかの変更もずっと送れなくなる。
          // outbox には残すので、「送っていない変更」に数えられる（短くすれば送る）
          if (JSON.stringify(data).length > SYNC_LIMITS.maxEntityBytes) continue
          changes.push({ kind: entry.kind, id: entry.id, updatedAt: local.updatedAt, deleted: false, data })
        } else {
          // 端末に無い＝消した。消した時刻を updatedAt として送る
          changes.push({ kind: entry.kind, id: entry.id, updatedAt: entry.at, deleted: true })
        }
        sent.push(entry)
      }
      const res = (await (
        await api(config, '/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ since, changes }),
        })
      ).json()) as SyncResponse

      if (!(await stillConnected(config))) return
      tooLarge = outbox.length - sent.length
      await applyRemote(res.changes)
      await db.transaction('rw', db.outbox, db.meta, async () => {
        // 送っている間にまた変わったものは、次の回で送る
        for (const entry of sent) {
          const now = await db.outbox.get([entry.kind, entry.id])
          if (now && now.at === entry.at) await db.outbox.delete([entry.kind, entry.id])
        }
        await db.meta.put({ key: CURSOR_KEY, value: res.cursor })
      })
      // 送れないもの（大きすぎる）だけが残っていたら、終わり
      if (!res.more && (await db.outbox.count()) <= outbox.length - sent.length) break
    }
    if (recheck) {
      await recheckCloudFlags()
      // 見直した写真・サムネイルを置いて、もう一度送る
      return await doSync()
    }
    await setStatus({
      lastSyncedAt: Date.now(),
      ...((await photosFull()) ? { photosFull: true } : {}),
      ...(tooLarge > 0 ? { tooLarge } : {}),
    })
  } catch (e) {
    // ログアウトしたあとに失敗を書き戻さない（次にログインしたとき、前の失敗が出ないように）
    if (await stillConnected(config)) await setStatus({ ...(await getSyncStatus()), error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

async function photosFull(): Promise<boolean> {
  const at = (await db.meta.get(PHOTOS_FULL_KEY))?.value as number | undefined
  return at !== undefined && Date.now() - at < PHOTOS_FULL_RETRY_MS
}

/** 写真の置ける量を超えたことを覚える（写真・サムネイルを送るのを、しばらく休む） */
async function markPhotosFull() {
  await db.meta.put({ key: PHOTOS_FULL_KEY, value: Date.now() })
}

/** 写真（縮小済み）をサーバーに置く。置けたら cloudPhoto を立てて、ほかの端末でも見られるようにする */
async function uploadPhotos(config: SyncConfig) {
  if (await photosFull()) return
  // 縮小できなかった大きい写真はサーバーに置かない（この端末にだけ残る）
  const targets = await db.media
    .filter((m) => m.type.startsWith('image/') && hasContent(m) && !m.cloudPhoto && m.size <= PHOTO_MAX_BYTES)
    .toArray()
  for (const m of targets) {
    // ログアウトしたら、残りは送らない
    if (!(await stillConnected(config))) return
    try {
      const body = await contentBlob(m)
      if (!body) continue
      await api(config, `/api/photos/${encodeURIComponent(m.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': m.type },
        body,
      })
    } catch (e) {
      // 電波が無いときは同期ごと止める。サーバーが受け付けない写真・端末にファイルが無い写真は飛ばして、ほかの同期を続ける
      if ((e instanceof SyncError && e.status === 400) || e instanceof ContentUnavailableError) continue
      // サーバーに置ける量を超えたら、写真は置かずに、記録などの同期を続ける
      if (e instanceof SyncError && e.status === 413) return markPhotosFull()
      throw e
    }
    await db.transaction('rw', db.media, db.outbox, async () => {
      // 送っているあいだに写真を差し替えたら、印を立てない（新しい写真を次に送る）
      if ((await db.media.get(m.id))?.contentAt !== m.contentAt) return
      await db.media.update(m.id, { cloudPhoto: true, updatedAt: Date.now() })
      await db.outbox.put({ kind: 'media', id: m.id, at: Date.now() })
    })
  }
}

/**
 * 動画のサムネイル（できあがりのコマ）をサーバーに置く。YouTube のサムネイルは動画の途中のコマなので、
 * 端末から動画を消したあとや、入れ直した端末・別の端末でも、カップの絵と再生前の絵を出せるようにする
 */
async function uploadPosters(config: SyncConfig) {
  if (await photosFull()) return
  // まだ置いていないもの、置いたのが前の作り方（最初のコマ）で、できあがりのコマを作り直したもの
  const targets = await db.media
    .filter(
      (m) =>
        m.type.startsWith('video/') &&
        !!m.poster &&
        m.poster.size <= PHOTO_MAX_BYTES &&
        (!m.cloudPoster || (!!m.posterEnd && !m.cloudPosterEnd)),
    )
    .toArray()
  for (const m of targets) {
    if (!(await stillConnected(config))) return
    try {
      await api(config, `/api/photos/${encodeURIComponent(posterPhotoId(m.id))}`, {
        method: 'PUT',
        headers: { 'Content-Type': m.poster!.type || 'image/jpeg' },
        body: m.poster,
      })
    } catch (e) {
      if (e instanceof SyncError && e.status === 400) continue
      if (e instanceof SyncError && e.status === 413) return markPhotosFull()
      throw e
    }
    await db.transaction('rw', db.media, db.outbox, async () => {
      // 送っているあいだにサムネイルを作り直したら、印を立てない（新しいものを次に送る）
      const current = await db.media.get(m.id)
      if (!current || current.contentAt !== m.contentAt || !!current.posterEnd !== !!m.posterEnd) return
      await db.media.update(m.id, { cloudPoster: true, cloudPosterEnd: !!m.posterEnd, updatedAt: Date.now() })
      await db.outbox.put({ kind: 'media', id: m.id, at: Date.now() })
    })
  }
}

/** この端末にサムネイルが無い動画の、サーバーに置いたサムネイルを取ってきて保存する */
export async function fetchPoster(media: Media): Promise<Blob | undefined> {
  const config = await getSyncConfig()
  if (!config || !media.cloudPoster) return undefined
  // 同じ id のまま中身が置き直されるので、HTTP のキャッシュ（前の版のサーバーは1年残させていた）を使わない
  const poster = await (await api(config, `/api/photos/${encodeURIComponent(posterPhotoId(media.id))}`, { cache: 'no-store' })).blob()
  // サムネイルは小さいので、次からは端末から出す（同期の対象にはしない）
  await db.media.update(media.id, { poster, posterEnd: !!media.cloudPosterEnd })
  return poster
}

/** この端末に中身が無い写真を、サーバーから取ってきて保存する */
export async function fetchPhoto(media: Media): Promise<Blob | undefined> {
  const config = await getSyncConfig()
  if (!config || !media.cloudPhoto) return undefined
  const blob = await (await api(config, `/api/photos/${encodeURIComponent(media.id)}`, { cache: 'no-store' })).blob()
  // 写真は小さいので、次からは端末から出す（同期の対象にはしない）。アプリではファイルに移す
  await db.media.update(media.id, { blob })
  void moveContentsToFiles([media.id])
  return blob
}

// ---- 接続 ----

/** この端末で中身を読める動画・写真か。アプリでは、行にファイルの場所があっても、ファイルが無いことがある */
async function readableContent(): Promise<(m: Media) => boolean> {
  const files = usesFiles ? new Set(await listContentFiles().catch(() => [])) : undefined
  return (m) => !!m.blob || (!!m.file && (!files || files.has(m.file)))
}

/**
 * この端末に中身のある写真・サムネイルは、サーバーに置き直す
 * （サーバーにしか中身が無いものの印は残す。同じアカウントなら、そのまま取ってこられる）
 */
async function recheckCloudFlags() {
  const readable = await readableContent()
  await db.transaction('rw', db.media, db.meta, async () => {
    await db.media.toCollection().modify((m) => {
      if (readable(m)) delete m.cloudPhoto
      if (m.poster) {
        delete m.cloudPoster
        delete m.cloudPosterEnd
      }
    })
    await db.meta.delete(RECHECK_PHOTOS_KEY)
  })
}

/**
 * 同期を始める。サーバーにすでにデータがあれば（2台目の端末）、この端末の初期データ（updatedAt が 0）は捨ててから受け取る。
 * サーバーが空なら（1台目）、この端末のデータを全部送る
 */
export async function connectWithConfig(config: SyncConfig): Promise<{ firstDevice: boolean }> {
  // 分野・型は、あとで書き直されると後ろのページに移るので、見つかるか最後のページまで見る
  let firstDevice = true
  for (let since = 0, round = 0; round < 50; round++) {
    const page = (await (
      await api(config, '/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since, changes: [] }),
      })
    ).json()) as SyncResponse
    if (page.changes.some((c) => !c.deleted && (c.kind === 'domain' || c.kind === 'skill'))) {
      firstDevice = false
      break
    }
    if (!page.more) break
    since = page.cursor
  }

  await db.transaction('rw', [db.domains, db.skills, db.records, db.media, db.meta, db.outbox], async () => {
    if (!firstDevice) {
      // 手を付けていない初期データだけを捨てる（記録があるスキルや、使い始めた分野は残す）
      const recorded = new Set((await db.records.toArray()).map((r) => r.skillId))
      await db.skills.filter((s) => s.updatedAt === 0 && !recorded.has(s.id)).delete()
      const used = new Set((await db.skills.toArray()).map((s) => s.domainId))
      await db.domains.filter((d) => d.updatedAt === 0 && !used.has(d.id)).delete()
    }
    // 接続前にたまった印は、下で全件を積み直すので消す（捨てた初期データの削除を送らないように）
    await db.outbox.clear()
    // 前に別のアカウントでつないでいたかもしれないので、受け取りきったあとに写真を置いた印を見直す
    await db.meta.put({ key: RECHECK_PHOTOS_KEY, value: true })
    // 端末に残っているものは全部送る（サーバーのほうが新しいものは上書きされない）
    const all = [
      ...(await db.domains.toCollection().primaryKeys()).map((id) => ({ kind: 'domain' as const, id: id as string })),
      ...(await db.skills.toCollection().primaryKeys()).map((id) => ({ kind: 'skill' as const, id: id as string })),
      ...(await db.records.toCollection().primaryKeys()).map((id) => ({ kind: 'record' as const, id: id as string })),
      ...(await db.media.toCollection().primaryKeys()).map((id) => ({ kind: 'media' as const, id: id as string })),
    ]
    const at = Date.now()
    await db.outbox.bulkPut([...all.map((e) => ({ ...e, at })), { kind: 'settings', id: 'settings', at }])
    await db.meta.put({ key: CONFIG_KEY, value: config })
    await db.meta.put({ key: CURSOR_KEY, value: 0 })
  })
  // 前のログインの同期が動いていたら、止まるのを待ってから、このログインで同期する
  // （runSync は動いている同期を返すので、そのままだと前のログインの同期を待つことになる）
  while (running) await running.catch(() => {})
  await runSync()
  return { firstDevice }
}

export async function disconnectSync() {
  await db.meta.bulkDelete([CONFIG_KEY, CURSOR_KEY, STATUS_KEY, PHOTOS_FULL_KEY, RECHECK_PHOTOS_KEY])
  // 動いている同期が終わるのを待つ（このあと端末のデータを消しても、受け取ったものが書き戻されないように）。
  // 同期は次の区切りで止まる。電波が悪くて終わらなくても、長くは待たない
  if (running) await Promise.race([running.catch(() => {}), new Promise((r) => setTimeout(r, 5000))])
}

// ---- 自動で同期する ----

/** 書き込みがあったら少し待って送る。画面に戻ったとき・電波が戻ったとき・5分ごとにも同期する */
export function startAutoSync(onError?: (e: unknown) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const kick = (delay: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      runSync().catch((e) => onError?.(e))
    }, delay)
  }
  const sub = liveQuery(() => db.outbox.count()).subscribe((n) => {
    if (n > 0) kick(1500)
  })
  const onVisible = () => {
    if (document.visibilityState === 'visible') kick(0)
  }
  const onOnline = () => kick(0)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  const interval = setInterval(() => kick(0), 5 * 60 * 1000)
  kick(0)
  return () => {
    clearTimeout(timer)
    clearInterval(interval)
    sub.unsubscribe()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
  }
}

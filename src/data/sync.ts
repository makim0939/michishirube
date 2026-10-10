import { liveQuery } from 'dexie'
import type { EntityChange, EntityKind, SyncResponse } from '../../shared/protocol'
import { PHOTO_MAX_BYTES, SYNC_LIMITS } from '../../shared/protocol'
import { DEFAULT_SETTINGS, type Media, type Settings } from '../domain/types'
import { db } from './db'

/**
 * サーバー（Cloudflare Worker + D1）との同期。
 * 画面はいつも端末の IndexedDB を読み書きし、変更は outbox にためてまとめて送る。
 * 同じものが両方で変わっていたら、updatedAt が新しいほうを残す。
 */

export interface SyncConfig {
  /** Worker の URL（例: https://michishirube-api.xxx.workers.dev） */
  url: string
  token: string
}

export interface SyncStatus {
  lastSyncedAt?: number
  error?: string
}

const CONFIG_KEY = 'sync:config'
const CURSOR_KEY = 'sync:cursor'
const STATUS_KEY = 'sync:status'

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
  if (res.status === 401) throw new SyncError('トークンが違います', 401)
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
  // 動画・写真の中身は送らない（動画は YouTube、写真は別の API）
  const { blob: _blob, ...rest } = row
  return rest
}

/** サーバーから来た変更を端末に反映する。端末のほうが新しければ何もしない */
export async function applyRemote(changes: EntityChange[]) {
  await db.transaction('rw', [db.domains, db.skills, db.records, db.media, db.meta], async () => {
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
        // 中身はこの端末だけのものなので、持っていれば残す
        const blob = (local as Media | undefined)?.blob
        if (blob) row.blob = blob
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

async function doSync() {
  const config = await getSyncConfig()
  if (!config) return
  try {
    await uploadPhotos(config)
    // 送りきるまで、または受け取りきるまで繰り返す（上限つき）
    for (let round = 0; round < 50; round++) {
      const since = ((await db.meta.get(CURSOR_KEY))?.value as number | undefined) ?? 0
      const outbox = await db.outbox.limit(SYNC_LIMITS.maxChanges).toArray()
      const changes: EntityChange[] = []
      for (const entry of outbox) {
        const local = await readLocal(entry.kind, entry.id)
        changes.push(
          local
            ? {
                kind: entry.kind,
                id: entry.id,
                updatedAt: local.updatedAt,
                deleted: false,
                data: toWire(entry.kind, local as Record<string, unknown>),
              }
            : // 端末に無い＝消した。消した時刻を updatedAt として送る
              { kind: entry.kind, id: entry.id, updatedAt: entry.at, deleted: true },
        )
      }
      const res = (await (
        await api(config, '/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ since, changes }),
        })
      ).json()) as SyncResponse

      await applyRemote(res.changes)
      await db.transaction('rw', db.outbox, db.meta, async () => {
        // 送っている間にまた変わったものは、次の回で送る
        for (const entry of outbox) {
          const now = await db.outbox.get([entry.kind, entry.id])
          if (now && now.at === entry.at) await db.outbox.delete([entry.kind, entry.id])
        }
        await db.meta.put({ key: CURSOR_KEY, value: res.cursor })
      })
      if (!res.more && (await db.outbox.count()) === 0) break
    }
    await setStatus({ lastSyncedAt: Date.now() })
  } catch (e) {
    await setStatus({ ...(await getSyncStatus()), error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

/** 写真（縮小済み）をサーバーに置く。置けたら cloudPhoto を立てて、ほかの端末でも見られるようにする */
async function uploadPhotos(config: SyncConfig) {
  // 縮小できなかった大きい写真はサーバーに置かない（この端末にだけ残る）
  const targets = await db.media
    .filter((m) => m.type.startsWith('image/') && !!m.blob && !m.cloudPhoto && m.blob.size <= PHOTO_MAX_BYTES)
    .toArray()
  for (const m of targets) {
    try {
      await api(config, `/api/photos/${encodeURIComponent(m.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': m.type },
        body: m.blob,
      })
    } catch (e) {
      // 電波が無いときは同期ごと止める。サーバーが受け付けない写真は飛ばして、ほかの同期を続ける
      if (e instanceof SyncError && e.status === 400) continue
      throw e
    }
    await db.transaction('rw', db.media, db.outbox, async () => {
      await db.media.update(m.id, { cloudPhoto: true, updatedAt: Date.now() })
      await db.outbox.put({ kind: 'media', id: m.id, at: Date.now() })
    })
  }
}

/** この端末に中身が無い写真を、サーバーから取ってきて保存する */
export async function fetchPhoto(media: Media): Promise<Blob | undefined> {
  const config = await getSyncConfig()
  if (!config || !media.cloudPhoto) return undefined
  const blob = await (await api(config, `/api/photos/${encodeURIComponent(media.id)}`)).blob()
  // 写真は小さいので、次からは端末から出す（同期の対象にはしない）
  await db.media.update(media.id, { blob })
  return blob
}

// ---- 接続 ----

/**
 * 同期を始める。サーバーにすでにデータがあれば（2台目の端末）、この端末の初期データ（updatedAt が 0）は捨ててから受け取る。
 * サーバーが空なら（1台目）、この端末のデータを全部送る
 */
export async function connectSync(input: SyncConfig): Promise<{ firstDevice: boolean }> {
  const config = { url: input.url.trim().replace(/\/+$/, ''), token: input.token.trim() }
  if (!/^https?:\/\//.test(config.url)) throw new SyncError('URL は https:// から入れてください')
  await api(config, '/api/health')

  const first = (await (
    await api(config, '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: 0, changes: [] }),
    })
  ).json()) as SyncResponse
  const firstDevice = !first.changes.some((c) => !c.deleted && (c.kind === 'domain' || c.kind === 'skill'))

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
  await runSync()
  return { firstDevice }
}

export async function disconnectSync() {
  await db.meta.bulkDelete([CONFIG_KEY, CURSOR_KEY, STATUS_KEY])
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

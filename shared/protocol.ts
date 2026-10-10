/** アプリとサーバー（Cloudflare Worker）の間でやり取りする形。両方から import する */

export const ENTITY_KINDS = ['domain', 'skill', 'record', 'media', 'settings'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

export interface EntityChange {
  kind: EntityKind
  id: string
  /** 端末で最後に変更した時刻。新しいほうが勝つ */
  updatedAt: number
  deleted: boolean
  data?: Record<string, unknown> | null
}

export interface SyncRequest {
  /** 前回受け取った cursor。初回は 0 */
  since: number
  changes: EntityChange[]
}

export interface SyncResponse {
  cursor: number
  changes: EntityChange[]
  /** まだ続きがあれば true（cursor を since にしてもう一度呼ぶ） */
  more: boolean
}

export const SYNC_LIMITS = {
  /** 1回で送れる変更の数 */
  maxChanges: 500,
  /** 1件の JSON の大きさ */
  maxEntityBytes: 64 * 1024,
  /** 1回で返す変更の数 */
  pageSize: 500,
} as const

/** 写真は縮小してから送るので、これを超えるものは受け付けない */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024

export function isEntityKind(v: unknown): v is EntityKind {
  return typeof v === 'string' && (ENTITY_KINDS as readonly string[]).includes(v)
}

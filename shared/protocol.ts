/** アプリとサーバー（Cloudflare Worker）の間でやり取りする形。両方から import する */

export const ENTITY_KINDS = ['domain', 'skill', 'record', 'media', 'settings'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

/**
 * 前に画面にあった型の項目（参考の目安・出典）。いまは使わず、端末とサーバーのデータからも消した。
 * 古い端末・バックアップ・写しから届いた型に残っていることがあるので、受け取るときに取り除く
 */
export const LEGACY_SKILL_FIELDS = ['criteria', 'sources'] as const

/** 型のデータから、消した項目を除いたコピー（元は変えない） */
export function withoutLegacySkillFields<T extends object>(row: T): Omit<T, (typeof LEGACY_SKILL_FIELDS)[number]> {
  const copy = { ...row } as Record<string, unknown>
  for (const field of LEGACY_SKILL_FIELDS) delete copy[field]
  return copy as Omit<T, (typeof LEGACY_SKILL_FIELDS)[number]>
}

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
  /** 1回で送れる変更の数（サーバー側で14件ずつ1文にまとめるので、15文に収まる） */
  maxChanges: 200,
  /** 1件の JSON の大きさ */
  maxEntityBytes: 64 * 1024,
  /** 1回で返す変更の数 */
  pageSize: 500,
} as const

/** 写真は縮小してから送るので、これを超えるものは受け付けない */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024

/** 1人が置ける写真・サムネイルの合計（無料のデータベースの大きさに収めるため） */
export const PHOTO_QUOTA_BYTES = 50 * 1024 * 1024

/** 動画のサムネイルを、写真と同じ置き場に置くときの id の末尾 */
export const POSTER_SUFFIX = '.poster'

/** 動画のサムネイルを、写真と同じ置き場に置くときの id */
export const posterPhotoId = (mediaId: string) => `${mediaId}${POSTER_SUFFIX}`

/** 写真の置き場の id から、どの動画・写真のものかを読む */
export const mediaIdOfPhoto = (photoId: string) =>
  photoId.endsWith(POSTER_SUFFIX) ? photoId.slice(0, -POSTER_SUFFIX.length) : photoId

export function isEntityKind(v: unknown): v is EntityKind {
  return typeof v === 'string' && (ENTITY_KINDS as readonly string[]).includes(v)
}

import type { Media } from '../domain/types'
import { db } from './db'
import { getSettings } from './repo'

/**
 * 端末の容量を空けるため、YouTube に上げ終えた古い動画を端末から消す（YouTube には残る）。
 * 比べるのに使う「最初の1本」と「最新の数本」、残す印を付けたものは消さない
 */

export const TIDY_POLICY = {
  /** これより古いものだけを消す */
  minAgeDays: 14,
  /** スキルごとに端末に残す、新しい動画の本数 */
  keepLatest: 3,
} as const

type MediaInfo = Pick<Media, 'id' | 'skillId' | 'type' | 'createdAt' | 'keep' | 'youtubeId'> & { hasBlob: boolean }

export function selectVideosToDrop(media: MediaInfo[], now: number, policy = TIDY_POLICY): string[] {
  const videos = media.filter((m) => m.type.startsWith('video/'))
  const protectedIds = new Set<string>()
  const bySkill = new Map<string, MediaInfo[]>()
  for (const m of videos) bySkill.set(m.skillId, [...(bySkill.get(m.skillId) ?? []), m])
  for (const list of bySkill.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt)
    protectedIds.add(list[0].id)
    for (const m of list.slice(-policy.keepLatest)) protectedIds.add(m.id)
  }
  const cutoff = now - policy.minAgeDays * 24 * 60 * 60 * 1000
  return videos
    .filter((m) => m.hasBlob && m.youtubeId && !m.keep && !protectedIds.has(m.id) && m.createdAt < cutoff)
    .map((m) => m.id)
}

/** 自動整理がオンなら、消せる動画の中身を端末から消す。消した本数と大きさを返す */
export async function tidyVideos(now = Date.now()): Promise<{ count: number; bytes: number }> {
  if (!(await getSettings()).autoTidy) return { count: 0, bytes: 0 }
  const media = await db.media.toArray()
  const ids = selectVideosToDrop(
    media.map((m) => ({ ...m, hasBlob: !!m.blob })),
    now,
  )
  let bytes = 0
  await db.transaction('rw', db.media, async () => {
    for (const id of ids) {
      const m = await db.media.get(id)
      bytes += m?.blob?.size ?? 0
      // 中身はこの端末だけのものなので、同期の対象にしない（updatedAt も変えない）
      await db.media.update(id, { blob: undefined })
    }
  })
  return { count: ids.length, bytes }
}

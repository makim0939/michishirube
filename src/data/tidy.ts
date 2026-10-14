import type { Media } from '../domain/types'
import { contentBlob, hasContent } from './content'
import { db } from './db'
import { inMemory, makePoster } from './mediaPrep'
import { needsLocalPoster } from './poster'
import { getVideoStorage } from './videoStorage'
import { youtubePlayable } from './youtube'

/**
 * 保存先が YouTube のとき、YouTube に上げ終えた動画を端末から消す（YouTube には残り、アプリの中でも再生できる）。
 * 撮ってすぐは編集できるように、少し置いてから消す。YouTube 側で再生できると確かめられたものだけを消す
 */

/** 撮った（編集した）日から、この日数がたった動画を消す。YouTube 側の処理も、それまでに終わっている */
export const TIDY_AFTER_DAYS = 3

type MediaInfo = Pick<Media, 'id' | 'type' | 'createdAt' | 'contentAt' | 'upload' | 'youtubeId'> & { hasBlob: boolean }

export function selectVideosToDrop(media: MediaInfo[], now: number, afterDays = TIDY_AFTER_DAYS): string[] {
  const cutoff = now - afterDays * 24 * 60 * 60 * 1000
  return media
    .filter(
      (m) =>
        m.type.startsWith('video/') &&
        m.hasBlob &&
        m.upload === 'done' &&
        !!m.youtubeId &&
        // 編集した動画は、上げ直した日から数える
        (m.contentAt ?? m.createdAt) < cutoff,
    )
    .map((m) => m.id)
}

/** 保存先が YouTube なら、消せる動画の中身を端末から消す。消した本数と大きさを返す */
export async function tidyVideos(now = Date.now()): Promise<{ count: number; bytes: number }> {
  if ((await getVideoStorage()) !== 'youtube') return { count: 0, bytes: 0 }
  const media = await db.media.toArray()
  const candidates = selectVideosToDrop(
    media.map((m) => ({ ...m, hasBlob: hasContent(m) })),
    now,
  )
  // 端末の動画が唯一の手元の写しになるので、YouTube 側で再生できると確かめられたものだけを消す
  // （非公開のまま・処理に失敗した動画を消すと、アプリで見られなくなる）
  const ids: string[] = []
  for (const id of candidates) {
    const youtubeId = media.find((m) => m.id === id)?.youtubeId
    if (youtubeId && (await youtubePlayable(youtubeId))) ids.push(id)
  }
  // 消したあとに再生前の絵として出せるよう、先にサムネイルを作っておく。
  // サムネイルは同期でサーバーにも置かれ、入れ直した端末でも出せる
  for (const id of ids) {
    const m = await db.media.get(id)
    if (!m || !needsLocalPoster(m)) continue
    try {
      const content = await contentBlob(m)
      if (!content) continue
      const poster = await makePoster(await inMemory(content))
      if (poster && (poster.end || !m.poster)) await db.media.update(id, { poster: poster.blob, posterEnd: poster.end })
    } catch {
      // 作れなくても、整理は続ける
    }
  }
  let bytes = 0
  await db.transaction('rw', db.media, async () => {
    for (const id of ids) {
      const m = await db.media.get(id)
      bytes += m?.blob?.size ?? (m?.file ? m.size : 0)
      // 中身はこの端末だけのものなので、同期の対象にしない（updatedAt も変えない）。
      // アプリのファイルは、行から外すと watchContentFiles が消す
      await db.media.update(id, { blob: undefined, file: undefined })
    }
  })
  return { count: ids.length, bytes }
}

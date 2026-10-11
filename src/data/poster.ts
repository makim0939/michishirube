import type { Media } from '../domain/types'
import { db } from './db'
import { inMemory, makePoster } from './mediaPrep'
import { fetchPoster } from './sync'

/**
 * 動画のサムネイル（できあがりのカップ＝最後のコマ）をそろえる。
 * 端末に動画があれば作り、無ければサーバーに置いたものを取ってくる
 */

const isVideo = (m: Media) => m.type.startsWith('video/')

/** 端末の動画から作り直す（まだ無い・前の作り方の最初のコマ） */
export function needsLocalPoster(m: Media): boolean {
  return isVideo(m) && !!m.blob && (!m.poster || !m.posterEnd)
}

/** サーバーから取ってくる（端末に動画が無く、サーバーにもっとよいサムネイルがある） */
export function needsRemotePoster(m: Media): boolean {
  return isVideo(m) && !m.blob && !!m.cloudPoster && (!m.poster || (!m.posterEnd && !!m.cloudPosterEnd))
}

/** カップの絵として出せるか（写真、または動画のできあがりのコマ） */
export function hasCupImage(m: Media | undefined): boolean {
  if (!m) return false
  if (!isVideo(m)) return !!m.blob || !!m.cloudPhoto
  return (!!m.poster && !!m.posterEnd) || !!m.cloudPosterEnd
}

// 動画を読み込むのは重いので、1本ずつ順に作る。同じ動画を二重に作らない
let queue: Promise<unknown> = Promise.resolve()
const pending = new Set<string>()

export function ensurePoster(m: Media) {
  const local = needsLocalPoster(m)
  const remote = !local && needsRemotePoster(m)
  if ((!local && !remote) || pending.has(m.id)) return
  pending.add(m.id)
  queue = queue
    .then(async () => {
      if (remote) {
        await fetchPoster(m)
        return
      }
      // iPhone では IndexedDB の動画を直接読めないことがあるので、メモリに写してから作る
      const poster = await makePoster(await inMemory(m.blob!))
      // 作り直したら、サーバーにも置き直す（cloudPosterEnd が立つまで同期で送る）
      if (poster) await db.media.update(m.id, { poster, posterEnd: true })
    })
    .catch(() => {
      // 作れない・取れないときは、次に出すときにまた試す
    })
    .finally(() => pending.delete(m.id))
}

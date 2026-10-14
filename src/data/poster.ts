import type { Media } from '../domain/types'
import { contentBlob, hasContent } from './content'
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
  return isVideo(m) && hasContent(m) && (!m.poster || !m.posterEnd)
}

/** サーバーから取ってくる（端末に動画が無く、サーバーにもっとよいサムネイルがある） */
export function needsRemotePoster(m: Media): boolean {
  return isVideo(m) && !hasContent(m) && !!m.cloudPoster && (!m.poster || (!m.posterEnd && !!m.cloudPosterEnd))
}

/**
 * 今日の大きな写真に出せるか。写真だけを使う（動画の最後のコマに、きれいにカップが写っているとは限らないので）
 */
export function hasCupImage(m: Media | undefined): boolean {
  return !!m && !isVideo(m) && (hasContent(m) || !!m.cloudPhoto)
}

// 動画を読み込むのは重いので、1本ずつ順に作る。同じ動画を二重に作らない
let queue: Promise<unknown> = Promise.resolve()
const pending = new Set<string>()
// 作れなかった動画は、アプリを開いている間は作り直さない（開くたびに動画全体を読み込まないように）
const failed = new Set<string>()

export function ensurePoster(m: Media) {
  const local = needsLocalPoster(m) && !failed.has(m.id)
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
      const content = await contentBlob(m)
      if (!content) return
      const poster = await makePoster(await inMemory(content))
      // 最後のコマにできなかったら、最初のコマで我慢して、開いている間は作り直さない
      if (!poster?.end) failed.add(m.id)
      // 作り直したら、サーバーにも置き直す（cloudPosterEnd が立つまで同期で送る）
      if (poster && (poster.end || !m.poster)) await db.media.update(m.id, { poster: poster.blob, posterEnd: poster.end })
    })
    .catch(() => {
      // 作れない・取れないときは、作るほうは開いている間は試さない（取るほうは次に出すときにまた試す）
      if (local) failed.add(m.id)
    })
    .finally(() => pending.delete(m.id))
}

import type { Media } from '../domain/types'
import { contentBlob, hasContent, mayBeOnServer } from './content'
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
 * 今日の大きな写真に出せるか。写真だけを使う（動画の最後のコマに、きれいにカップが写っているとは限らないので）。
 * canFetch は、サーバーから取ってこられるか（ログインしているか）。サーバーに置いた印が端末の行に無くても、
 * 取ってこられるなら、サーバーにあるかもしれない写真を候補にする。取ってこられないのに候補にすると、写真の出ない空の枠が出る
 */
export function hasCupImage(m: Media | undefined, canFetch = false): boolean {
  return !!m && !isVideo(m) && (hasContent(m) || !!m.cloudPhoto || (canFetch && mayBeOnServer(m)))
}

/**
 * 作ったサムネイルを、その動画の行に付ける。作っているあいだに中身が差し替わった（切り取った・ほかの端末で替えた）なら、
 * 付けない（前の動画のコマが、新しい動画のサムネイルとして残らないように。新しい動画のものは、次に出すときに作る）。
 * 付けたら true
 */
export async function attachPoster(m: Pick<Media, 'id' | 'contentAt' | 'createdAt'>, poster: Blob, end: boolean) {
  return db.transaction('rw', db.media, async () => {
    const current = await db.media.get(m.id)
    if (!current || (current.contentAt ?? current.createdAt) !== (m.contentAt ?? m.createdAt)) return false
    await db.media.update(m.id, { poster, posterEnd: end })
    return true
  })
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
      // 作り直したら、サーバーにも置き直す（cloudPosterEnd が立つまで同期で送る）。
      // 差し替わっていて付けなかったら、新しい動画のために、作れなかった印も付けない
      if (poster && (poster.end || !m.poster) && !(await attachPoster(m, poster.blob, poster.end))) return
      // 最後のコマにできなかったら、最初のコマで我慢して、開いている間は作り直さない
      if (!poster?.end) failed.add(m.id)
    })
    .catch(() => {
      // 作れない・取れないときは、作るほうは開いている間は試さない（取るほうは次に出すときにまた試す）
      if (local) failed.add(m.id)
    })
    .finally(() => pending.delete(m.id))
}

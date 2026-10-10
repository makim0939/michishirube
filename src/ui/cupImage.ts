import { useEffect, useState } from 'react'
import { db } from '../data/db'
import { inMemory, makePoster } from '../data/mediaPrep'
import { fetchPhoto } from '../data/sync'
import type { Media } from '../domain/types'
import { isVideo } from './common'

/** 記録の動画・写真から、カップの絵として見せる1つを選ぶ（写真があれば写真、無ければ動画） */
export function pickCupMedia(list: (Media | undefined)[]): Media | undefined {
  const media = list.filter((m): m is Media => !!m)
  return media.find((m) => !isVideo(m)) ?? media.find((m) => isVideo(m))
}

/** 写真として見せられるものがあるか（この端末にある、またはサーバーから取れる） */
export function hasPhoto(m: Media | undefined): boolean {
  return !!m && !isVideo(m) && (!!m.blob || !!m.cloudPhoto)
}

/**
 * カップの絵の中身。写真はこの端末に無ければサーバーから取り、動画はサムネイルを使う
 * （サムネイルがまだ無ければ作る）
 */
export function useCupImage(media: Media | undefined): Blob | undefined {
  const [fetched, setFetched] = useState<Blob>()
  const id = media?.id
  const video = !!media && isVideo(media)
  const needsFetch = !!media && !video && !media.blob && !!media.cloudPhoto
  const needsPoster = !!media && video && !!media.blob && !media.poster

  useEffect(() => {
    setFetched(undefined)
  }, [id])

  useEffect(() => {
    if (!needsFetch || !media) return
    let cancelled = false
    fetchPhoto(media)
      .then((b) => {
        if (!cancelled) setFetched(b)
      })
      .catch(() => {
        // 電波が無いなどで取れなければ、無いまま
      })
    return () => {
      cancelled = true
    }
    // 同期のたびに media は別のオブジェクトになるので、id が変わったときだけ取り直す
  }, [id, needsFetch])

  useEffect(() => {
    if (!needsPoster || !media?.blob) return
    const blob = media.blob
    const mediaId = media.id
    void (async () => {
      try {
        // iPhone では IndexedDB の動画を直接読めないことがあるので、メモリに写してから作る
        const poster = await makePoster(await inMemory(blob))
        // サムネイルはこの端末だけのものなので、同期の対象にしない
        if (poster) await db.media.update(mediaId, { poster })
      } catch {
        // 作れなければ、次に開いたときにまた試す
      }
    })()
  }, [id, needsPoster])

  if (!media) return undefined
  if (video) return media.poster
  return media.blob ?? fetched
}

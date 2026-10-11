import { useEffect, useState } from 'react'
import { ensurePoster, needsLocalPoster, needsRemotePoster } from '../data/poster'
import { fetchPhoto } from '../data/sync'
import type { Media } from '../domain/types'
import { isVideo } from './common'

/** 記録の動画・写真から、カップの絵として見せる1つを選ぶ（写真があれば写真、無ければ動画） */
export function pickCupMedia(list: (Media | undefined)[]): Media | undefined {
  const media = list.filter((m): m is Media => !!m)
  return media.find((m) => !isVideo(m)) ?? media.find((m) => isVideo(m))
}

/**
 * カップの絵の中身。写真はこの端末に無ければサーバーから取り、動画はサムネイル（できあがりのコマ）を使う
 * （無ければ作るか、サーバーから取る）
 */
export function useCupImage(media: Media | undefined, { upgrade = true }: { upgrade?: boolean } = {}): Blob | undefined {
  // どのメディアのために取った写真かも覚えておく（別のカップに切り替わった直後に、前の写真を出さないように）
  const [fetched, setFetched] = useState<{ id: string; blob: Blob }>()
  const id = media?.id
  const video = !!media && isVideo(media)
  const needsFetch = !!media && !video && !media.blob && !!media.cloudPhoto

  useEffect(() => {
    if (!needsFetch || !media) return
    let cancelled = false
    const mediaId = media.id
    fetchPhoto(media)
      .then((b) => {
        if (!cancelled && b) setFetched({ id: mediaId, blob: b })
      })
      .catch(() => {
        // 電波が無いなどで取れなければ、無いまま
      })
    return () => {
      cancelled = true
    }
    // 同期のたびに media は別のオブジェクトになるので、id が変わったときだけ取り直す
  }, [id, needsFetch])

  usePoster(media, upgrade)

  if (!media) return undefined
  if (video) return media.poster
  return media.blob ?? (fetched?.id === media.id ? fetched.blob : undefined)
}

/**
 * 動画のサムネイルが無い・前の作り方（最初のコマ）なら、作るかサーバーから取る。
 * upgrade が false なら、前の作り方のサムネイルはそのまま使う（一覧を見ただけで、たくさんの動画を読み込まないように）
 */
export function usePoster(media: Media | undefined, upgrade = true) {
  const needs =
    !!media && ((needsLocalPoster(media) && (upgrade || !media.poster)) || needsRemotePoster(media))
  useEffect(() => {
    if (needs && media) ensurePoster(media)
    // 同期のたびに media は別のオブジェクトになるので、id と要否が変わったときだけ
  }, [media?.id, needs])
}

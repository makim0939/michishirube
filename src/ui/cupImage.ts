import { useEffect, useRef, useState } from 'react'
import { ensurePoster, needsLocalPoster, needsRemotePoster } from '../data/poster'
import { contentBlob } from '../data/content'
import { fetchPhoto } from '../data/sync'
import { youtubeThumbnail } from '../data/youtube'
import type { Media } from '../domain/types'
import { isVideo, useObjectUrl } from './common'

/** 記録の動画・写真から、カップの絵として見せる1つを選ぶ（写真があれば写真、無ければ動画） */
export function pickCupMedia(list: (Media | undefined)[]): Media | undefined {
  const media = list.filter((m): m is Media => !!m)
  return media.find((m) => !isVideo(m)) ?? media.find((m) => isVideo(m))
}

/**
 * 動画・写真の中身。端末にあればそれを、アプリでファイルにあれば読み込み、
 * 写真が端末に無ければサーバーから取ってくる（電波が無いなどで取れなければ undefined）
 */
export function useContent(media: Media | undefined): Blob | undefined {
  // 中身そのものを表す名前。置き場所が blob からファイルに移っても変わらない（差し替えると変わる）
  const id = media ? `${media.id}-${media.contentAt ?? media.createdAt}` : undefined
  // 読んだ中身と、それがどの中身か（別の杯に切り替わった直後・差し替えた直後に、前の中身を出さないように）
  const [loaded, setLoaded] = useState<{ id: string; blob: Blob }>()
  // 端末の blob を出していたら覚えておく。保存のあとファイルに移っても、読み直さずに同じ中身を出し続ける
  //（読み終わるまで一瞬消えたり、動画が最初から読み込み直しになったりしないように）
  const shown = useRef<{ id: string; blob: Blob }>(undefined)
  if (id && media?.blob) shown.current = { id, blob: media.blob }
  const source =
    media && !media.blob ? (media.file ?? (!isVideo(media) && media.cloudPhoto ? `cloud:${media.id}` : undefined)) : undefined

  useEffect(() => {
    if (!source || !media || !id || shown.current?.id === id) return
    let cancelled = false
    const read = media.file ? contentBlob(media) : fetchPhoto(media)
    read
      .then((b) => {
        if (!cancelled && b) setLoaded({ id, blob: b })
      })
      .catch(() => {
        // 読めない・電波が無いなどで取れなければ、無いまま
      })
    return () => {
      cancelled = true
    }
    // 同期のたびに media は別のオブジェクトになるので、中身か場所が変わったときだけ読み直す
  }, [id, source])

  if (!media || !id) return undefined
  if (media.blob) return media.blob
  if (!source) return undefined
  if (shown.current?.id === id) return shown.current.blob
  return loaded?.id === id ? loaded.blob : undefined
}

/**
 * カップの絵の中身。写真はこの端末に無ければサーバーから取り、動画はサムネイル（できあがりのコマ）を使う
 * （無ければ作るか、サーバーから取る）
 */
export function useCupImage(media: Media | undefined, { upgrade = true }: { upgrade?: boolean } = {}): Blob | undefined {
  const video = !!media && isVideo(media)
  // 動画の中身は読まない（サムネイルを使う）
  const photo = useContent(video ? undefined : media)
  usePoster(media, upgrade)
  if (!media) return undefined
  if (video) return media.poster
  return photo
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

/**
 * カップの絵の URL。端末にもサーバーにも絵が無い YouTube の動画は、YouTube のサムネイルを使う
 * （真っ暗・見本の絵にならないように）
 */
export function useCupImageUrl(
  media: Media | undefined,
  key: string,
  options: { upgrade?: boolean } = {},
): string | undefined {
  const blob = useCupImage(media, options)
  const url = useObjectUrl(blob, media ? `${media.id}-${key}-${blob?.size ?? 0}` : undefined)
  if (url) return url
  return media && isVideo(media) && media.youtubeId ? youtubeThumbnail(media.youtubeId) : undefined
}

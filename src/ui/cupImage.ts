import { useEffect, useMemo, useRef, useState } from 'react'
import { ensurePoster, needsLocalPoster, needsRemotePoster } from '../data/poster'
import { contentBlob } from '../data/content'
import { fetchPhoto } from '../data/sync'
import { youtubeThumbnail } from '../data/youtube'
import type { Media } from '../domain/types'
import { isVideo } from './common'
import { acquireUrl, recallContent, rememberContent, urlFor } from './imageCache'

/**
 * 写真の表示用 URL。key は中身が変われば変わるもの。画面を開き直しても、最初の描画から URL が入っている
 * （useObjectUrl は、描画のあとで URL を作るので、開き直した直後に1コマだけ空になる）
 */
export function useImageUrl(blob: Blob | undefined, key: string | undefined): string | undefined {
  const url = useMemo(() => (blob && key ? urlFor(key, blob) : undefined), [blob, key])
  useEffect(() => (key ? acquireUrl(key) : undefined), [key, url])
  return url
}

/** 記録の動画・写真から、カップの絵として見せる1つを選ぶ（写真があれば写真、無ければ動画） */
export function pickCupMedia(list: (Media | undefined)[]): Media | undefined {
  const media = list.filter((m): m is Media => !!m)
  return media.find((m) => !isVideo(m)) ?? media.find((m) => isVideo(m))
}

/**
 * 動画・写真の中身。端末にあればそれを、アプリでファイルにあれば読み込み、
 * 写真が端末に無ければ（ファイルを読めなければ）サーバーから取ってくる。
 * loading は読んでいる途中（無いのか、まだ読めていないだけかを分ける。読み終わるまでは「無い」表示を出さない）
 */
export function useContent(media: Media | undefined): { blob?: Blob; loading: boolean } {
  // 中身そのものを表す名前。置き場所が blob からファイルに移っても変わらない（差し替えると変わる）
  const id = media ? `${media.id}-${media.contentAt ?? media.createdAt}` : undefined
  // 端末の blob を出していたら覚えておく。保存のあとファイルに移っても、ファイルを読み終わるまでは同じ中身を出し続ける
  //（読み終わるまで一瞬消えないように。IndexedDB から消した blob は読めなくなることがあるので、読めたらファイルのほうに替える）
  const shown = useRef<{ id: string; blob: Blob }>(undefined)
  if (id && media?.blob) shown.current = { id, blob: media.blob }
  const cloud = !!media && !isVideo(media) && !!media.cloudPhoto
  const source = media && !media.blob ? (media.file ?? (cloud ? `cloud:${media.id}` : undefined)) : undefined
  // どの中身を・どこから読んだ結果か（別の杯に切り替わった直後・差し替えた直後に、前の中身を出さないように）。
  // blob が無ければ、読めなかった
  const key = id && source ? `${id}|${source}` : undefined
  const [loaded, setLoaded] = useState<{ key: string; blob?: Blob }>()
  // 前に読んだ中身（画面を開き直したときに、読み直すあいだ空にならないように）
  const cached = key ? recallContent(key) : undefined

  useEffect(() => {
    if (!key || !media || cached) return
    let cancelled = false
    const read = media.file
      ? contentBlob(media).catch((e: unknown) => (cloud ? fetchPhoto(media) : Promise.reject(e)))
      : fetchPhoto(media)
    read
      .then((b) => {
        if (b) rememberContent(key, b)
        if (!cancelled) setLoaded({ key, blob: b })
      })
      .catch(() => {
        // 読めない・電波が無いなどで取れなければ、無いまま
        if (!cancelled) setLoaded({ key })
      })
    return () => {
      cancelled = true
    }
    // 同期のたびに media は別のオブジェクトになるので、中身か場所が変わったときだけ読み直す
  }, [key])

  if (!media || !id) return { loading: false }
  if (media.blob) return { blob: media.blob, loading: false }
  if (!key) return { loading: false }
  if (loaded?.key === key && loaded.blob) return { blob: loaded.blob, loading: false }
  if (cached) return { blob: cached, loading: false }
  if (shown.current?.id === id) return { blob: shown.current.blob, loading: false }
  return { loading: loaded?.key !== key }
}

/**
 * カップの絵の中身。写真はこの端末に無ければサーバーから取り、動画はサムネイル（できあがりのコマ）を使う
 * （無ければ作るか、サーバーから取る）
 */
export function useCupImage(media: Media | undefined, { upgrade = true }: { upgrade?: boolean } = {}): Blob | undefined {
  const video = !!media && isVideo(media)
  // 動画の中身は読まない（サムネイルを使う）
  const photo = useContent(video ? undefined : media).blob
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
  const url = useImageUrl(blob, media ? `${media.id}-${key}-${blob?.size ?? 0}` : undefined)
  if (url) return url
  return media && isVideo(media) && media.youtubeId ? youtubeThumbnail(media.youtubeId) : undefined
}

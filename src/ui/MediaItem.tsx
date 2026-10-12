import { useEffect, useState } from 'react'
import { setMediaKeep } from '../data/repo'
import { fetchPhoto } from '../data/sync'
import { MAX_UPLOAD_ATTEMPTS, retryUpload, youtubeUrl } from '../data/youtube'
import type { Media } from '../domain/types'
import { isVideo, MediaView, useObjectUrl } from './common'
import { usePoster } from './cupImage'
import { useAction, useToast } from './feedback'
import { ShareMediaButton } from './ShareMedia'
import { ExternalIcon, PhotoIcon, PinIcon, PlayIcon, VideoIcon } from './icons'

const UPLOAD_LABEL = {
  pending: 'YouTube へのアップ待ち',
  uploading: 'YouTube へアップ中…',
  failed: 'YouTube へのアップに失敗',
} as const

/** この端末に写真の中身が無ければ、サーバーから取ってくる */
function useRemotePhoto(media: Media): Blob | undefined {
  const [blob, setBlob] = useState<Blob>()
  const needsFetch = !media.blob && !isVideo(media) && !!media.cloudPhoto
  useEffect(() => {
    if (!needsFetch) return
    let cancelled = false
    fetchPhoto(media)
      .then((b) => {
        if (!cancelled) setBlob(b)
      })
      .catch(() => {
        // 電波が無いなどで取れなければ、空のまま
      })
    return () => {
      cancelled = true
    }
    // 同期のたびに media は別のオブジェクトになるので、id が変わったときだけ取り直す
  }, [media.id, needsFetch])
  return media.blob ?? blob
}

/**
 * 記録の動画・写真1つ。端末に中身があれば再生し、無ければ YouTube やサーバーから見る。
 * 動画は YouTube へのアップ状況と、自動整理で消さない「残す」印も出す
 */
export function MediaItem({
  media,
  videoRef,
  autoLoad = false,
  bare = false,
}: {
  media: Media
  videoRef?: (el: HTMLVideoElement | null) => void
  /** 動画をすぐ読み込む（最初と最新を比べるとき） */
  autoLoad?: boolean
  /** 動画・写真だけを出し、保存・共有などの操作は出さない（狭い列で見比べるとき） */
  bare?: boolean
}) {
  const run = useAction()
  const toast = useToast()
  const blob = useRemotePhoto(media)
  usePoster(media)
  const video = isVideo(media)
  // 端末に動画が無いときも、サムネイルがあれば YouTube へのリンクの背景に出す
  const posterUrl = useObjectUrl(!blob && video ? media.poster : undefined, `${media.id}-yt-poster-${media.poster?.size ?? 0}`)

  return (
    <figure className={bare ? 'media-item' : 'media-item media-card'}>
      {blob ? (
        <MediaView
          blob={blob}
          type={media.type}
          poster={media.poster}
          cacheKey={media.id}
          autoLoad={autoLoad}
          videoRef={videoRef}
        />
      ) : video && media.youtubeId ? (
        <a
          className={`media placeholder${posterUrl ? ' with-poster' : ''}`}
          style={posterUrl ? { backgroundImage: `url(${posterUrl})` } : undefined}
          href={youtubeUrl(media.youtubeId)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <PlayIcon size={22} />
          YouTube で見る
          <small>（非公開・YouTube アプリで再生）</small>
        </a>
      ) : (
        <div className="media placeholder">
          {video ? <VideoIcon size={22} /> : <PhotoIcon size={22} />}
          この端末にはありません
        </div>
      )}
      {/* この動画・写真への操作は、すぐ下に付けたバーにまとめる（どれへの操作か分かるように） */}
      {!bare && (blob || (video && (media.upload || media.youtubeId))) && (
        <figcaption className="media-toolbar">
          <span className="media-toolbar-status">
            {video && media.upload === 'failed' && (media.uploadAttempts ?? 0) >= MAX_UPLOAD_ATTEMPTS && blob ? (
              <button
                type="button"
                className="tool-button"
                title={media.uploadError}
                onClick={() => run(() => retryUpload(media.id))}
              >
                ↻ アップを再試行
              </button>
            ) : video && media.upload && media.upload !== 'done' ? (
              <span className={`upload upload-${media.upload}`} title={media.uploadError}>
                {UPLOAD_LABEL[media.upload]}
              </span>
            ) : video && media.youtubeId && blob ? (
              <a className="tool-button" href={youtubeUrl(media.youtubeId)} target="_blank" rel="noopener noreferrer">
                YouTube
                <ExternalIcon size={15} label="（別の画面で開く）" />
              </a>
            ) : null}
          </span>
          {blob && <ShareMediaButton media={media} blob={blob} />}
          {/* 古い動画の自動整理で、この端末から消さない印 */}
          {video && blob && (
            <button
              type="button"
              className={`tool-button${media.keep ? ' on' : ''}`}
              aria-pressed={!!media.keep}
              onClick={() =>
                run(async () => {
                  await setMediaKeep(media.id, !media.keep)
                  toast.show(
                    media.keep
                      ? '「端末に残す」を外しました'
                      : 'この動画は、古い動画を整理するときも端末に残します',
                  )
                })
              }
            >
              <PinIcon size={17} filled={media.keep} />
              端末に残す
            </button>
          )}
        </figcaption>
      )}
    </figure>
  )
}

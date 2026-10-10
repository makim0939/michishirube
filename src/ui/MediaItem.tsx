import { useEffect, useState } from 'react'
import { setMediaKeep } from '../data/repo'
import { fetchPhoto } from '../data/sync'
import { MAX_UPLOAD_ATTEMPTS, retryUpload, youtubeUrl } from '../data/youtube'
import type { Media } from '../domain/types'
import { isVideo, MediaView } from './common'
import { useAction } from './feedback'

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
}: {
  media: Media
  videoRef?: (el: HTMLVideoElement | null) => void
  /** 動画をすぐ読み込む（最初と最新を比べるとき） */
  autoLoad?: boolean
}) {
  const run = useAction()
  const blob = useRemotePhoto(media)
  const video = isVideo(media)

  return (
    <figure className="media-item">
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
        <a className="media placeholder" href={youtubeUrl(media.youtubeId)} target="_blank" rel="noopener noreferrer">
          <span aria-hidden="true">▶</span>
          YouTube で見る
          <small>（非公開・YouTube アプリで再生）</small>
        </a>
      ) : (
        <div className="media placeholder">
          <span aria-hidden="true">{video ? '🎥' : '📷'}</span>
          この端末にはありません
        </div>
      )}
      {video && (
        <figcaption className="media-caption">
          {media.upload === 'failed' && (media.uploadAttempts ?? 0) >= MAX_UPLOAD_ATTEMPTS && blob ? (
            <button
              type="button"
              className="keep"
              title={media.uploadError}
              onClick={() => run(() => retryUpload(media.id))}
            >
              ↻ アップを再試行
            </button>
          ) : media.upload && media.upload !== 'done' ? (
            <span className={`upload upload-${media.upload}`} title={media.uploadError}>
              {UPLOAD_LABEL[media.upload]}
            </span>
          ) : media.youtubeId && blob ? (
            <a href={youtubeUrl(media.youtubeId)} target="_blank" rel="noopener noreferrer">
              YouTube
            </a>
          ) : (
            <span />
          )}
          <button
            type="button"
            className={`keep ${media.keep ? 'on' : ''}`}
            aria-pressed={!!media.keep}
            title="自動整理で、この端末から消さない"
            onClick={() => run(() => setMediaKeep(media.id, !media.keep))}
          >
            {media.keep ? '★ 残す' : '☆ 残す'}
          </button>
        </figcaption>
      )}
    </figure>
  )
}

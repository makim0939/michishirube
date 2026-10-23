import { useLiveQuery } from 'dexie-react-hooks'
import { getVideoStorage } from '../data/videoStorage'
import { MAX_UPLOAD_ATTEMPTS, retryUpload, youtubeUrl } from '../data/youtube'
import type { Media } from '../domain/types'
import { isVideo, MediaView, type PlayerControl, videoControl } from './common'
import { useContent, usePoster } from './cupImage'
import { useAction } from './feedback'
import { ShareLinkButton, ShareMediaButton } from './ShareMedia'
import { ExternalIcon, PhotoIcon, VideoIcon } from './icons'
import { YoutubePlayer } from './YoutubePlayer'

const UPLOAD_LABEL = {
  pending: 'YouTube へのアップ待ち',
  uploading: 'YouTube へアップ中…',
  failed: 'YouTube へのアップに失敗',
} as const

/**
 * 記録の動画・写真1つ。端末に中身があれば再生し、無ければ YouTube（アプリの中で再生）やサーバーから見る。
 * 保存先が YouTube なら、動画のアップ状況も出す
 */
export function MediaItem({
  media,
  playerRef,
  autoLoad = false,
  bare = false,
}: {
  media: Media
  /** 見比べで、2本を同時に再生するための操作を受け取る */
  playerRef?: (p: PlayerControl | null) => void
  /** 動画をすぐ読み込む（最初と最新を比べるとき） */
  autoLoad?: boolean
  /** 動画・写真だけを出し、保存・共有などの操作は出さない（狭い列で見比べるとき） */
  bare?: boolean
}) {
  const run = useAction()
  const storage = useLiveQuery(getVideoStorage)
  const { blob, loading } = useContent(media)
  usePoster(media)
  const video = isVideo(media)
  // 保存先が端末なら上げないので、アップ待ちは出さない
  const uploadState = video && storage === 'youtube' && media.upload !== 'done' ? media.upload : undefined
  const onYoutube = video && !!media.youtubeId
  // 読み込み中もバーを出しておく（読めたときにバーが現れて、下が動かないように）
  const toolbar = !bare && (blob || loading || onYoutube || !!uploadState)

  return (
    <figure className={bare ? 'media-item' : 'media-item media-card'}>
      {blob ? (
        <MediaView
          blob={blob}
          type={blob.type || media.type}
          poster={media.poster}
          // 同じ id のまま中身が差し替わる（切り取った・ほかの端末で写真を替えた）ので、中身ごとに分ける
          cacheKey={`${media.id}-${media.contentAt ?? media.createdAt}`}
          autoLoad={autoLoad}
          videoRef={playerRef && ((el) => playerRef(el ? videoControl(el) : null))}
        />
      ) : loading ? (
        // 端末のファイルを読んでいるあいだは、YouTube や「無い」表示に切り替えない（読めたらすぐ出す）
        <div className="media placeholder" role="status" aria-label="読み込み中" />
      ) : onYoutube ? (
        // 別の動画に替わったら（上げ直し）、作り直す。読み込めなかった・再生中などの状態を、前の動画から持ち越さない
        <YoutubePlayer
          key={media.youtubeId}
          videoId={media.youtubeId!}
          poster={media.poster}
          cacheKey={media.id}
          playerRef={playerRef}
        />
      ) : (
        <div className="media placeholder">
          {video ? <VideoIcon size={22} /> : <PhotoIcon size={22} />}
          この端末にはありません
        </div>
      )}
      {/* この動画・写真への操作は、すぐ下に付けたバーにまとめる（どれへの操作か分かるように） */}
      {toolbar && (
        <figcaption className="media-toolbar">
          <span className="media-toolbar-status">
            {uploadState === 'failed' && (media.uploadAttempts ?? 0) >= MAX_UPLOAD_ATTEMPTS && blob ? (
              <button
                type="button"
                className="tool-button"
                title={media.uploadError}
                onClick={() => run(() => retryUpload(media.id))}
              >
                ↻ アップを再試行
              </button>
            ) : uploadState ? (
              <span className={`upload upload-${uploadState}`} title={media.uploadError}>
                {UPLOAD_LABEL[uploadState]}
              </span>
            ) : onYoutube ? (
              <a className="tool-button" href={youtubeUrl(media.youtubeId!)} target="_blank" rel="noopener noreferrer">
                YouTube
                <ExternalIcon size={15} label="（別の画面で開く）" />
              </a>
            ) : null}
          </span>
          {blob ? (
            <ShareMediaButton media={media} blob={blob} />
          ) : (
            onYoutube && <ShareLinkButton youtubeId={media.youtubeId!} />
          )}
        </figcaption>
      )}
    </figure>
  )
}

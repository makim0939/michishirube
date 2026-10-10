/**
 * 端末の容量とアップロード時間を抑えるため、撮る時点で小さくする。
 * スマホ標準のカメラ（1080p・高画質）より、1分あたりの大きさが数分の1になる
 */

/**
 * 720p・1.2Mbps。ラテアートの注ぎや手元の動きを確かめるには十分で、1分あたり約9MB。
 * 音声は 96kbps（64kbps だと Chrome の AAC エンコーダーが Internal Error で止まる）
 */
export const RECORDER_BITRATE = { video: 1_200_000, audio: 96_000 } as const

export const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
}

/** 録画は5分まで（撮り忘れで大きくなりすぎないように） */
export const MAX_RECORDING_MS = 5 * 60 * 1000

// iPhone の Safari は MP4（H.264）。YouTube もそのまま受け付ける
const WITH_AUDIO = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
const VIDEO_ONLY = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']

/** 音を録らないときに音声コーデックを指定すると、録画を始められないブラウザがあるので分ける */
export function pickRecorderMimeType(isSupported: (type: string) => boolean, withAudio = true): string | undefined {
  return (withAudio ? WITH_AUDIO : VIDEO_ONLY).find((t) => isSupported(t))
}

export function extensionFor(mimeType: string): string {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

/** 写真の長い辺 */
const PHOTO_MAX_EDGE = 1600
const PHOTO_QUALITY = 0.82

/** 写真を縮小した JPEG にする。縮めても小さくならない・読めないときは元のまま返す */
export async function compressPhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/** メモリに読み込んだ Blob。iPhone の Safari は IndexedDB に置いた動画を直接再生できないことがあるので、再生の前に写す */
export async function inMemory(blob: Blob): Promise<Blob> {
  return new Blob([await blob.arrayBuffer()], { type: blob.type })
}

function once(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(event, done)
      reject(new Error(`timeout: ${event}`))
    }, timeoutMs)
    const done = () => {
      clearTimeout(timer)
      target.removeEventListener(event, done)
      resolve()
    }
    target.addEventListener(event, done)
  })
}

/**
 * 動画の長さ（秒）。録画した WebM などは長さが Infinity になることがあるので、末尾まで読ませて求める
 */
export async function probeDuration(video: HTMLVideoElement): Promise<number> {
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) await once(video, 'loadedmetadata', 10_000)
  if (Number.isFinite(video.duration)) return video.duration
  const back = video.currentTime
  video.currentTime = 1e101
  await once(video, 'durationchange', 10_000).catch(() => {})
  video.currentTime = back
  return Number.isFinite(video.duration) ? video.duration : 0
}

const POSTER_MAX_EDGE = 480

/** 動画の最初のあたりの1コマを、一覧に出すサムネイル（JPEG）にする。作れなければ undefined */
export async function makePoster(blob: Blob): Promise<Blob | undefined> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    video.load()
    await once(video, 'loadeddata', 5000)
    const duration = await probeDuration(video)
    video.currentTime = Math.min(0.2, duration / 2 || 0)
    await once(video, 'seeked', 5000)
    const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    if (!canvas.width || !canvas.height) return undefined
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    return (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7))) ?? undefined
  } catch {
    return undefined
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

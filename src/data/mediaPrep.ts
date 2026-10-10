/**
 * 端末の容量とアップロード時間を抑えるため、撮る時点で小さくする。
 * スマホ標準のカメラ（1080p・高画質）より、1分あたりの大きさが数分の1になる
 */

/** 720p・1.2Mbps。ラテアートの注ぎや手元の動きを確かめるには十分で、1分あたり約9MB */
export const RECORDER_BITRATE = { video: 1_200_000, audio: 64_000 } as const

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

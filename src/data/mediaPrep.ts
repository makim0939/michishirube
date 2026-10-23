import { isIosDevice } from '../platform'
import type { VideoQuality } from './videoStorage'

/**
 * 端末の容量とアップロード時間を抑えるため、撮る時点で画質を決める。
 * スマホ標準のカメラ（4K・高画質）より、1分あたりの大きさが数分の1になる
 */

export interface QualityPreset {
  /** 短い辺の画素数（縦の動画なら横幅） */
  shortSide: number
  video: number
  audio: number
}

/**
 * - 標準：720p・1.2Mbps。ラテアートの注ぎや手元の動きを確かめるには十分で、30秒で約5MB
 * - 高画質：1080p・6Mbps。SNS に出しても見劣りしない。30秒で約23MB
 * 音声は 96kbps 以上（64kbps だと Chrome の AAC エンコーダーが Internal Error で止まる）
 */
export const QUALITY: Record<VideoQuality, QualityPreset> = {
  standard: { shortSide: 720, video: 1_200_000, audio: 96_000 },
  high: { shortSide: 1080, video: 6_000_000, audio: 128_000 },
}

/** 30秒の動画のおよその大きさ（MB）。設定画面で目安として出す */
export function megabytesPer30s(quality: VideoQuality): number {
  const { video, audio } = QUALITY[quality]
  return Math.round(((video + audio) * 30) / 8 / 1_000_000)
}

export function cameraConstraints(quality: VideoQuality): MediaTrackConstraints {
  const short = QUALITY[quality].shortSide
  return {
    facingMode: { ideal: 'environment' },
    width: { ideal: Math.round((short * 16) / 9) },
    height: { ideal: short },
    frameRate: { ideal: 30, max: 30 },
  }
}

/**
 * 画面の押した場所（映像の枠の中の座標）が、カメラの元の映像のどこ（0〜1）に当たるか。
 * プレビューは object-fit: cover で映していて、はみ出た分は見えないので、その分をずらして計算する。
 * 見えていないところ（はみ出た側）を押すことはないが、念のため 0〜1 に収める
 */
export function tapToSourcePoint(
  box: { width: number; height: number },
  source: { width: number; height: number },
  tap: { x: number; y: number },
): { x: number; y: number } | undefined {
  if (!box.width || !box.height || !source.width || !source.height) return undefined
  const scale = Math.max(box.width / source.width, box.height / source.height)
  const offsetX = (box.width - source.width * scale) / 2
  const offsetY = (box.height - source.height * scale) / 2
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  return {
    x: clamp((tap.x - offsetX) / (source.width * scale)),
    y: clamp((tap.y - offsetY) / (source.height * scale)),
  }
}

/** ピントの合わせ方。ブラウザの型定義に focusMode・pointsOfInterest が無いので、MediaTrackConstraintSet に型を合わせて渡す */
type FocusMode = 'continuous' | 'single-shot' | 'manual' | 'none'

/** 1回合わせたあと自動に戻すタイマー（続けて押したとき、前のタイマーが後の指定を壊さないよう、トラックごとに1つだけ持つ） */
const revertTimers = new WeakMap<MediaStreamTrack, ReturnType<typeof setTimeout>>()

/** 自動でピントを合わせ続ける（動くカップに追いつく）。対応していない端末では何もしない */
export async function keepAutoFocus(track: MediaStreamTrack): Promise<boolean> {
  const modes = (track.getCapabilities?.() as { focusMode?: string[] } | undefined)?.focusMode
  if (!modes?.includes('continuous')) return false
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
    return true
  } catch {
    return false
  }
}

/**
 * 押した場所（0〜1）にピントを合わせ、合わせたら自動に戻す。
 * 場所を指定できない端末（pointsOfInterest が無い）では、押しても何も起こさず false を返す
 */
export async function focusAt(track: MediaStreamTrack, point: { x: number; y: number }): Promise<boolean> {
  const modes = (track.getCapabilities?.() as { focusMode?: string[] } | undefined)?.focusMode
  if (!modes || !(navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, boolean> | undefined)?.pointsOfInterest) return false
  const mode: FocusMode | undefined = modes.includes('single-shot') ? 'single-shot' : modes.includes('continuous') ? 'continuous' : undefined
  if (!mode) return false
  try {
    await track.applyConstraints({ advanced: [{ focusMode: mode, pointsOfInterest: [point] } as MediaTrackConstraintSet] })
  } catch {
    return false
  }
  // 1回合わせたあとは、また自動で合わせ続ける（ピントが固定されたままにしない）
  clearTimeout(revertTimers.get(track))
  if (mode === 'single-shot') {
    revertTimers.set(
      track,
      setTimeout(() => {
        if (track.readyState === 'live') void keepAutoFocus(track)
      }, 1500),
    )
  }
  return true
}

/** 録画は5分まで（撮り忘れで大きくなりすぎないように） */
export const MAX_RECORDING_MS = 5 * 60 * 1000

// iPhone の Safari は MP4（H.264）。YouTube もそのまま受け付ける
const WITH_AUDIO = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
const VIDEO_ONLY = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
// 1080p は H.264 の Baseline（レベル 3.0）の上限を超えるので、高画質では High（レベル 4.0）を先に試す
const HIGH_WITH_AUDIO = ['video/mp4;codecs=avc1.640028,mp4a.40.2', ...WITH_AUDIO]
const HIGH_VIDEO_ONLY = ['video/mp4;codecs=avc1.640028', ...VIDEO_ONLY]

/** 音を録らないときに音声コーデックを指定すると、録画を始められないブラウザがあるので分ける */
/**
 * この端末で録画に失敗した形式（video/mp4 など）。Android では、MP4（H.264）を「使える」と答えても、
 * H.264 を作る部品（ハードウェア）が無い端末では中身が空になるので、失敗した形式は外して次の形式で撮る。
 * 画面の仕組み（WebView）が更新されたら直っているかもしれないので、そのときはもう一度試す
 */
const BROKEN_KEY = 'michishirube:recorder-broken'

function brokenTypes(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(BROKEN_KEY) ?? 'null') as { ua?: unknown; types?: unknown } | null
    if (!saved || saved.ua !== navigator.userAgent || !Array.isArray(saved.types)) return []
    return saved.types.filter((t): t is string => typeof t === 'string')
  } catch {
    return []
  }
}

/** 録画が空になった形式を覚える（この端末・この WebView の間だけ） */
export function markRecorderTypeBroken(mimeType: string) {
  const container = mimeType.split(';')[0]
  try {
    const types = [...new Set([...brokenTypes(), container])]
    localStorage.setItem(BROKEN_KEY, JSON.stringify({ ua: navigator.userAgent, types }))
  } catch {
    // 保存できなければ、次もこの形式を試す
  }
}

/**
 * 録画（切り取りの録り直しも）が空になった・勝手に止まった形式を、ほかの形式があるときだけ外す。外したら true。
 * iPhone・iPad は recorderSupports が MP4 しか答えないので「ほかの形式」が無く、外さない（WebM に切り替えない）
 */
export function fallBackFromRecorderType(mimeType: string, withAudio: boolean, quality: VideoQuality): boolean {
  const container = mimeType.split(';')[0]
  const others = !!pickRecorderMimeType((t) => recorderSupports(t) && !t.startsWith(container), withAudio, quality)
  if (others) markRecorderTypeBroken(mimeType)
  return others
}

export type RecordingVerdict = 'ok' | 'too-short' | 'broken'

/**
 * 録画の結果を見て、この形式がこの端末で使えるかを決める。
 * - 押して止めていないのに、録画を始めて3秒より前に止まった：映像を作る部品（H.264 のハードウェア）が無い端末
 *   （Android のエミュレーターなど）は、1秒ほどでエラーで止まる。この形式では撮れない
 *   （数秒たってから止まったのは、電話・アプリの切り替えなどの中断。撮れた分は残す）
 * - 0 バイト、または映像が入っていない（音声と見出しだけの数 KB）：同じく、この形式では撮れない。
 *   映像が入っていれば、静かな画面でも1秒あたり数十 KB にはなる
 * - 押してすぐ止めた（2秒より短い）のが空なのは、形式のせいではない
 */
export function judgeRecording(bytes: number, elapsedMs: number, stoppedByUser: boolean): RecordingVerdict {
  if (!stoppedByUser && elapsedMs < 3000) return 'broken'
  if (stoppedByUser && elapsedMs < 2000) return bytes === 0 ? 'too-short' : 'ok'
  return bytes < (elapsedMs / 1000) * 2000 ? 'broken' : 'ok'
}

/**
 * この端末で録画に使える形式か（使えると答えても、空になった形式は外す）。
 * iPhone・iPad は MP4 だけ。WebM で録画すると、切り取り・画質の作り直し・共有・保存が全部できなくなるので、
 * 「空になった形式」の記録（Android 向け）も使わない（1回の失敗で、ずっと WebM になってしまわないように）
 */
export function recorderSupports(type: string): boolean {
  if (isIosDevice()) return type.startsWith('video/mp4') && MediaRecorder.isTypeSupported(type)
  return MediaRecorder.isTypeSupported(type) && !brokenTypes().some((b) => type.startsWith(b))
}

/** 前の版で iPhone に残った「MP4 は空になる」という記録を消す（iPhone では使わないので、残す意味がない） */
export function forgetBrokenTypesOnIos() {
  if (!isIosDevice()) return
  try {
    localStorage.removeItem(BROKEN_KEY)
  } catch {
    // 消せなければ、そのまま（iPhone では使わない）
  }
}

export function pickRecorderMimeType(
  isSupported: (type: string) => boolean,
  withAudio = true,
  quality: VideoQuality = 'standard',
): string | undefined {
  const list = quality === 'high' ? (withAudio ? HIGH_WITH_AUDIO : HIGH_VIDEO_ONLY) : withAudio ? WITH_AUDIO : VIDEO_ONLY
  return list.find((t) => isSupported(t))
}

export function extensionFor(mimeType: string): string {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

/** 写真の一辺（正方形にそろえる） */
const PHOTO_MAX_EDGE = 1600
const PHOTO_QUALITY = 0.82

/** 写真を中央の正方形に切り取り、縮小した JPEG にする。読めないときは元のまま返す */
export async function compressPhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    // ラテアートは真上から撮ったカップが主役なので、中央を正方形に切り取ってそろえる
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    const size = Math.round(Math.min(side, PHOTO_MAX_EDGE))
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    canvas.getContext('2d')!.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY))
    if (!blob) return file
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

/** 今日の画面の大きな写真にも使うので、ある程度大きく作る */
const POSTER_MAX_EDGE = 960

export interface Poster {
  blob: Blob
  /** 最後のコマ（できあがり）か。最後まで読めなかったときは、最初のコマにして false */
  end: boolean
}

function seekTo(video: HTMLVideoElement, time: number, timeoutMs: number) {
  video.currentTime = time
  return once(video, 'seeked', timeoutMs)
}

/**
 * 動画の最後のあたりの1コマ（注ぎ終えた、できあがりのカップ）を、サムネイル（JPEG）にする。
 * 最後まで読めない動画（長い・形式が合わない）は、最初のあたりの1コマにする。どちらも作れなければ undefined
 */
export async function makePoster(blob: Blob): Promise<Poster | undefined> {
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
    let end = duration > 0.6
    try {
      // 最後のコマは端末によって真っ黒なことがあるので、少し手前にする
      await seekTo(video, end ? duration - 0.3 : duration / 2 || 0, 10_000)
    } catch {
      end = false
      await seekTo(video, Math.min(0.2, duration / 2 || 0), 5000)
    }
    const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    if (!canvas.width || !canvas.height) return undefined
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75))
    // 短すぎる動画は、真ん中のコマでも、できあがりとして扱う（長さが分からないときは、できあがりとは言えない）
    return jpeg ? { blob: jpeg, end: end || (duration > 0 && duration <= 0.6) } : undefined
  } catch {
    return undefined
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

import { ComposeCancelled, composeVideoFiles, deleteDir, deleteFile, readBlobFile, usesFiles, writeBlobFile } from './files'
import { QUALITY } from './mediaPrep'
import type { VideoQuality } from './videoStorage'
import { isIosApp } from '../platform'
import { t } from '../i18n'

/**
 * 複数の動画から区間を切り出し、順につないで 1 本にする（アプリの書き出し。iOS は AVFoundation、Android は Media3）。
 * 今の切り取り（trim.ts）は、再生しながら録り直すので実時間かかり、1 本の 1 区間しか切れない。
 * こちらは端末のエンコーダーで作るので速く、つなぐこともできる。Web 版では使えない（canCompose）
 */

/** 動画の中身。アプリのファイルにあればその場所、まだメモリにあれば Blob（一時ファイルに書いて渡す） */
export type ComposeSource = { file: string } | { blob: Blob }

export interface ComposeClip {
  source: ComposeSource
  /** 秒。切り出す始め */
  start: number
  /** 秒。切り出す終わり。省くと動画の終わりまで */
  end?: number
  /** 動画の長さ（秒）。end を省いたとき、つないだ全体の長さを求めるのに使う（BGM の終わりを小さくする位置） */
  duration?: number
}

/** BGM。入れた動画の長さまで繰り返し、終わりで小さくしていく */
export interface ComposeBgm {
  /** アプリのファイルの場所か、メモリの音声 */
  source: ComposeSource
  /** 0〜1。元の動画の音は、そのまま */
  volume: number
  /** 音声の拡張子（m4a・mp3 など）。一時ファイルの名前に使う。分からなければ m4a */
  extension?: string
}

/** 区間の最小の長さ（秒）。trim.ts の clampRange と同じ */
export const MIN_CLIP_SECONDS = 0.3
/** 5.3 - 5 のような引き算の誤差（0.2999…）で、ちょうど最小の範囲を弾かないための余裕 */
const EPSILON = 1e-6

export function canCompose(): boolean {
  return usesFiles
}

/**
 * 「つなぐ」の入口を出すか。いまは iPhone・iPad のアプリだけ
 * （Android の書き出しは、実機での確認が済んでから。Web 版は、書き出しの部品が無い）
 */
export const canJoinVideos = isIosApp

/** 渡された区間が書き出せる形か。空・負の始め・短すぎる範囲は、ネイティブに渡す前に断る */
export function checkClips(clips: ComposeClip[]) {
  if (clips.length === 0) throw new Error(t.compose.noClips)
  for (const c of clips) {
    if (!(c.start >= 0)) throw new Error(t.compose.badRange)
    if (c.end !== undefined && !(c.end - c.start >= MIN_CLIP_SECONDS - EPSILON)) throw new Error(t.compose.badRange)
  }
}

/** つないだ全体の長さ（秒）。長さが分からない区間（end も duration も無い）があれば 0 */
export function totalSeconds(clips: ComposeClip[]): number {
  let total = 0
  for (const c of clips) {
    const end = c.end ?? c.duration
    if (end === undefined) return 0
    total += Math.max(0, end - c.start)
  }
  return total
}

/**
 * 区間をつないだ動画（MP4）を作る。画質（quality）は呼ぶ側が決める。最初の区間より大きくはしない
 * （小さい動画は、そのままの大きさ）。失敗したら投げる（呼ぶ側は、元の動画をそのまま残す）
 */
export async function composeClips(
  clips: ComposeClip[],
  quality: VideoQuality,
  fileName: string,
  bgm?: ComposeBgm,
  /** 元の動画の音を使わない（BGM だけ、または無音） */
  muteOriginal = false,
  /** 進み具合（0〜1）。iOS だけ */
  onProgress?: (value: number) => void,
  /** 書き出しを始める前に見る。true なら、始めずにやめる（ファイルを書いている間に「やめる」を押されたとき） */
  isCancelled?: () => boolean,
): Promise<File> {
  if (!canCompose()) throw new Error(t.compose.unsupported)
  checkClips(clips)
  const dir = `compose/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const temps: string[] = []
  const output = `${dir}/out.mp4`
  try {
    const inputs: { input: string; start: number; end?: number }[] = []
    const blobInputs = new Map<Blob, string>()
    for (const [i, c] of clips.entries()) {
      let input: string
      if ('file' in c.source) {
        input = c.source.file
      } else {
        // 同じ動画から何区間も切り出す（分割）ときは、一度だけ書く
        const written = blobInputs.get(c.source.blob)
        if (written) {
          input = written
        } else {
          input = `${dir}/in-${i}.${c.source.blob.type.includes('webm') ? 'webm' : 'mp4'}`
          temps.push(input)
          await writeBlobFile(input, c.source.blob)
          blobInputs.set(c.source.blob, input)
        }
      }
      inputs.push({ input, start: c.start, ...(c.end === undefined ? {} : { end: c.end }) })
    }
    let bgmInput: { input: string; volume: number; totalSeconds: number } | undefined
    if (bgm) {
      let input: string
      if ('file' in bgm.source) {
        input = bgm.source.file
      } else {
        input = `${dir}/bgm.${bgm.extension || 'm4a'}`
        temps.push(input)
        await writeBlobFile(input, bgm.source.blob)
      }
      bgmInput = { input, volume: Math.max(0, Math.min(1, bgm.volume)), totalSeconds: totalSeconds(clips) }
    }
    if (isCancelled?.()) throw new ComposeCancelled()
    await composeVideoFiles(inputs, output, QUALITY[quality], bgmInput, muteOriginal, onProgress)
    // 読み終えた Blob は、ファイルを消しても読める（メモリにある）。もう一度写さない（長い動画で、メモリが倍になるため）
    const blob = await readBlobFile(output, 'video/mp4')
    const base = fileName.replace(/\.[^.]+$/, '').replace(/-edit$/, '')
    return new File([blob], `${base}-edit.mp4`, { type: 'video/mp4' })
  } finally {
    await Promise.all([...temps, output].map((p) => deleteFile(p)))
    await deleteDir(dir)
  }
}

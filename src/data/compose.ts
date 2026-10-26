import { composeVideoFiles, deleteFile, readBlobFile, usesFiles, writeBlobFile } from './files'
import { QUALITY } from './mediaPrep'
import type { VideoQuality } from './videoStorage'
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
}

/** 区間の最小の長さ（秒）。trim.ts の clampRange と同じ */
export const MIN_CLIP_SECONDS = 0.3

export function canCompose(): boolean {
  return usesFiles
}

/** 渡された区間が書き出せる形か。空・負の始め・短すぎる範囲は、ネイティブに渡す前に断る */
export function checkClips(clips: ComposeClip[]) {
  if (clips.length === 0) throw new Error(t.compose.noClips)
  for (const c of clips) {
    if (!(c.start >= 0)) throw new Error(t.compose.badRange)
    if (c.end !== undefined && !(c.end - c.start >= MIN_CLIP_SECONDS)) throw new Error(t.compose.badRange)
  }
}

/**
 * 区間をつないだ動画（MP4）を作る。画質は、元の動画の短い辺が大きければ高画質、そうでなければ標準
 * （切り取りと同じ考え方。大きくはしない）。失敗したら投げる（呼ぶ側は、元の動画をそのまま残す）
 */
export async function composeClips(clips: ComposeClip[], quality: VideoQuality, fileName: string): Promise<File> {
  if (!canCompose()) throw new Error(t.compose.unsupported)
  checkClips(clips)
  const dir = `compose/${Date.now().toString(36)}`
  const temps: string[] = []
  const output = `${dir}/out.mp4`
  try {
    const inputs: { input: string; start: number; end?: number }[] = []
    for (const [i, c] of clips.entries()) {
      let input: string
      if ('file' in c.source) {
        input = c.source.file
      } else {
        input = `${dir}/in-${i}.${c.source.blob.type.includes('webm') ? 'webm' : 'mp4'}`
        temps.push(input)
        await writeBlobFile(input, c.source.blob)
      }
      inputs.push({ input, start: c.start, ...(c.end === undefined ? {} : { end: c.end }) })
    }
    await composeVideoFiles(inputs, output, QUALITY[quality])
    const blob = await readBlobFile(output, 'video/mp4')
    // 書き出した MP4 は、一時ファイルを消す前にメモリへ写す（消すと読めなくなるため）
    const bytes = await blob.arrayBuffer()
    const base = fileName.replace(/\.[^.]+$/, '').replace(/-edit$/, '')
    return new File([bytes], `${base}-edit.mp4`, { type: 'video/mp4' })
  } finally {
    await Promise.all([...temps, output].map((p) => deleteFile(p)))
  }
}

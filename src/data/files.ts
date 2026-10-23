import { Capacitor, registerPlugin } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNativeApp } from '../platform'
import { t } from '../i18n'

/**
 * アプリ（iOS・Android）の中のファイル。動画・写真の中身と、記録の写し（snapshot.json）を置く。
 * 画面の中の保存場所（IndexedDB）は、端末の空きが少ないと OS に消されることがあるので、
 * 消えては困るものはアプリの「書類」に置く（端末のバックアップにも入る）。Web 版では使わない
 */

export const usesFiles = isNativeApp

const DIR = Directory.Data
const ROOT = 'lattecho'
let baseUri: string | undefined

/** 起動時に一度だけ。置き場所を用意し、画面から読むときの URL の元を覚える */
export async function initFiles() {
  if (!usesFiles) return
  try {
    await Filesystem.mkdir({ path: `${ROOT}/media`, directory: DIR, recursive: true })
  } catch {
    // すでにある
  }
  baseUri = (await Filesystem.getUri({ path: ROOT, directory: DIR })).uri
}

function fullPath(path: string) {
  return `${ROOT}/${path}`
}

/** 画面（WebView）から読むための URL */
function fileUrl(path: string): string {
  if (!baseUri) throw new Error(t.errors.filesNotReady)
  return Capacitor.convertFileSrc(`${baseUri}/${path}`)
}

/** Blob を base64 に。大きな動画でも一度に文字列にしないよう、呼ぶ側で区切って渡す */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** 3の倍数で区切ると、区切りごとの base64 をそのままつなげられる */
const CHUNK = 3 * 256 * 1024

/** Blob をファイルに書く。動画は大きいので、少しずつ足して書く（一度に大きな文字列を作らない） */
async function writeBlobTo(target: string, directory: Directory, blob: Blob) {
  await Filesystem.writeFile({
    path: target,
    directory,
    recursive: true,
    data: await toBase64(blob.slice(0, CHUNK)),
  })
  for (let offset = CHUNK; offset < blob.size; offset += CHUNK) {
    await Filesystem.appendFile({ path: target, directory, data: await toBase64(blob.slice(offset, offset + CHUNK)) })
  }
}

export async function writeBlobFile(path: string, blob: Blob) {
  await writeBlobTo(fullPath(path), DIR, blob)
}

/** 共有のために一時的に置く場所（アプリのキャッシュ。共有先のアプリが読み終わるまで、すぐには消さない） */
const SHARE_DIR = 'share'

/**
 * Android で、ファイルを共有シートに渡す（Android の画面の仕組み（WebView）には、Web の共有 API が無い）。
 * 一時ファイルに書いて、そのファイルを共有する。前に共有したファイルは、ここで片付ける。
 * 共有シートを閉じただけなら、そのまま戻る
 */
export async function shareFileNative(file: File) {
  await Filesystem.rmdir({ path: SHARE_DIR, directory: Directory.Cache, recursive: true }).catch(() => {})
  const path = `${SHARE_DIR}/${file.name}`
  await writeBlobTo(path, Directory.Cache, file)
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
  try {
    await Share.share({ files: [uri] })
  } catch (e) {
    // 共有シートを閉じただけ（Android は、閉じると "Share canceled" で失敗として返す）なら、失敗ではない
    if (/cancel/i.test(String((e as { message?: unknown } | null)?.message ?? e))) return
    throw e
  }
}

/**
 * 動画・写真のファイルが無い・読めない。ファイルが無いと fetch は通信の失敗と同じ TypeError になるので、
 * 区別できるようにこの形で投げる（読む側は、その1つを飛ばしてほかを続ける）
 */
export class ContentUnavailableError extends Error {
  constructor() {
    super(t.errors.noContentFile)
    this.name = 'ContentUnavailableError'
  }
}

/** ファイルを Blob として読む（YouTube に上げる・切り取る・書き出すときなど） */
export async function readBlobFile(path: string, type: string): Promise<Blob> {
  let res: Response
  try {
    // iOS のアプリは、動画（mp4 など）を Range なしで頼むと HTTP でない返事をするので fetch が失敗扱いにする。
    // 全体を Range で頼むと、どの種類でも 206 で返ってくる
    res = await fetch(fileUrl(path), { headers: { Range: 'bytes=0-' } })
  } catch (e) {
    // ファイルがあるのに読めなかった（アプリが裏に回って止められたなど）ときは、そのまま投げる（あとでまた試す）
    if (await fileExists(path)) throw e
    throw new ContentUnavailableError()
  }
  if (!res.ok) throw new ContentUnavailableError()
  const blob = await res.blob()
  // 種類だけ付け直す（slice は中身を写さない）
  return blob.type === type ? blob : blob.slice(0, blob.size, type)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path: fullPath(path), directory: DIR })
    return true
  } catch {
    return false
  }
}

interface VideoTranscoderPlugin {
  transcode(options: {
    input: string
    output: string
    maxShortSide: number
    videoBitrate: number
    audioBitrate: number
  }): Promise<{ skipped: boolean; size?: number }>
}

/** アプリの中だけのプラグイン（ios/App/App/VideoTranscoderPlugin.swift・android の VideoTranscoderPlugin.java） */
const VideoTranscoder = registerPlugin<VideoTranscoderPlugin>('VideoTranscoder')

/**
 * 動画のファイルを、決めた画質の MP4 に作り直して output に書く。すでにその画質以下なら作らずに skipped を返す
 */
export async function transcodeVideoFile(
  input: string,
  output: string,
  preset: { shortSide: number; video: number; audio: number },
): Promise<{ skipped: boolean; size?: number }> {
  return VideoTranscoder.transcode({
    input: fullPath(input),
    output: fullPath(output),
    maxShortSide: preset.shortSide,
    videoBitrate: preset.video,
    audioBitrate: preset.audio,
  })
}

/** 動画・写真のファイルの一覧（media/〇〇 の形） */
export async function listContentFiles(): Promise<string[]> {
  const { files } = await Filesystem.readdir({ path: `${ROOT}/media`, directory: DIR })
  return files.filter((f) => f.type === 'file').map((f) => `media/${f.name}`)
}

export async function deleteFile(path: string) {
  try {
    await Filesystem.deleteFile({ path: fullPath(path), directory: DIR })
  } catch {
    // もう無い
  }
}

/** 文字のファイルを書く。書きかけで止まっても前のものが残るよう、別名で書いてから入れ替える */
export async function writeTextFile(path: string, text: string) {
  const tmp = fullPath(`${path}.tmp`)
  await Filesystem.writeFile({ path: tmp, directory: DIR, data: text, encoding: Encoding.UTF8 })
  await deleteFile(path)
  await Filesystem.rename({ from: tmp, to: fullPath(path), directory: DIR, toDirectory: DIR })
}

export async function readTextFile(path: string): Promise<string | undefined> {
  try {
    const res = await Filesystem.readFile({ path: fullPath(path), directory: DIR, encoding: Encoding.UTF8 })
    return typeof res.data === 'string' ? res.data : await res.data.text()
  } catch {
    return undefined
  }
}

/** 動画・写真のファイルを全部消す（この端末のデータをすべて削除・バックアップから戻すとき） */
export async function deleteAllContentFiles() {
  if (!usesFiles) return
  try {
    await Filesystem.rmdir({ path: `${ROOT}/media`, directory: DIR, recursive: true })
  } catch {
    // もう無い
  }
  await Filesystem.mkdir({ path: `${ROOT}/media`, directory: DIR, recursive: true })
}

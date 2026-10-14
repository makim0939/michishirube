import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { isNativeApp } from '../platform'

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
export function fileUrl(path: string): string {
  if (!baseUri) throw new Error('ファイルの準備ができていません')
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
export async function writeBlobFile(path: string, blob: Blob) {
  const target = fullPath(path)
  await Filesystem.writeFile({ path: target, directory: DIR, data: await toBase64(blob.slice(0, CHUNK)) })
  for (let offset = CHUNK; offset < blob.size; offset += CHUNK) {
    await Filesystem.appendFile({ path: target, directory: DIR, data: await toBase64(blob.slice(offset, offset + CHUNK)) })
  }
}

/** ファイルを Blob として読む（YouTube に上げる・切り取る・書き出すときなど） */
export async function readBlobFile(path: string, type: string): Promise<Blob> {
  // iOS のアプリは、動画（mp4 など）を Range なしで頼むと HTTP でない返事をするので fetch が失敗扱いにする。
  // 全体を Range で頼むと、どの種類でも 206 で返ってくる
  const res = await fetch(fileUrl(path), { headers: { Range: 'bytes=0-' } })
  if (!res.ok) throw new Error('ファイルを読めませんでした')
  return new Blob([await res.arrayBuffer()], { type })
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

import type { Media } from '../domain/types'
import { db } from './db'
import {
  deleteAllContentFiles,
  deleteFile,
  listContentFiles,
  readBlobFile,
  transcodeVideoFile,
  usesFiles,
  writeBlobFile,
} from './files'
import { isIosApp } from '../platform'
import { QUALITY } from './mediaPrep'
import { getVideoSettings, type VideoQuality, type VideoSettings } from './videoStorage'

export { ContentUnavailableError } from './files'

/**
 * 動画・写真の中身。Web 版では IndexedDB の blob に、アプリではアプリのファイル（file）に置く。
 * 「端末に中身があるか」「中身を読む」は、どちらの置き方でもここを通す
 */

export function hasContent(m: Pick<Media, 'blob' | 'file'>): boolean {
  return !!m.blob || !!m.file
}

/** 中身を読む。無ければ undefined */
export async function contentBlob(m: Pick<Media, 'blob' | 'file' | 'type'>): Promise<Blob | undefined> {
  if (m.blob) return m.blob
  if (m.file) return readBlobFile(m.file, fileType(m.file) ?? m.type)
  return undefined
}

/** ファイルの拡張子から種類を決める（画質をそろえた動画は、元が WebM・MOV でも MP4 になっている） */
function fileType(path: string): string | undefined {
  if (path.endsWith('.mp4')) return 'video/mp4'
  if (path.endsWith('.mov')) return 'video/quicktime'
  if (path.endsWith('.webm')) return 'video/webm'
  return undefined
}

function extension(type: string): string {
  if (type.includes('mp4')) return 'mp4'
  if (type.includes('quicktime')) return 'mov'
  if (type.includes('webm')) return 'webm'
  if (type.includes('png')) return 'png'
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg'
  return 'bin'
}

/** 中身を差し替えるたびに別の名前にする（書きかけで止まっても、前の中身を壊さない） */
export function contentPath(m: Pick<Media, 'id' | 'type' | 'contentAt' | 'createdAt'>): string {
  return `media/${m.id}-${m.contentAt ?? m.createdAt}.${extension(m.type)}`
}

/** contentPath の名前から、どの動画・写真のファイルかを読む */
export function contentIdOf(path: string): string | undefined {
  return /^media\/(.+?)-\d+(?:-(?:standard|high))?\.[^.]+$/.exec(path)?.[1]
}

/** 画質をそろえた動画のファイル名。中身を差し替えるたびに変わる（contentPath と同じ） */
function optimizedPath(m: Pick<Media, 'id' | 'contentAt' | 'createdAt'>, quality: VideoQuality): string {
  return `media/${m.id}-${m.contentAt ?? m.createdAt}-${quality}.mp4`
}

/** 画質をそろえるのに、この回数失敗したらあきらめる */
const MAX_OPTIMIZE_TRIES = 3

/** 高画質で端末に置く動画を、この日数がたったら標準に軽くする（SNS に出すのは撮ってすぐのことが多いので） */
export const KEEP_HIGH_DAYS = 3

/**
 * その動画をどの画質にそろえるか。
 * - まだそろえていない動画（撮った・アルバムから入れた）は、撮るときに選んだ画質。選んでいなければ、いまの設定の画質
 * - そろえ済みの動画は、その画質のまま（標準を高画質に戻すことはできない）。ただし、端末に置く高画質の動画は、
 *   「高画質のまま残す」にしていなければ、日がたったら標準に軽くする
 */
export function targetQuality(
  m: Pick<Media, 'optimized' | 'quality' | 'contentAt' | 'createdAt'>,
  settings: VideoSettings,
  now: number,
): VideoQuality {
  const base = m.optimized ?? m.quality ?? settings.quality
  const old = (m.contentAt ?? m.createdAt) < now - KEEP_HIGH_DAYS * 24 * 60 * 60 * 1000
  if (base === 'high' && settings.storage === 'device' && !settings.keepHigh && old) return 'standard'
  return base
}

/**
 * その動画を、アプリで作り直せるか。iPhone の動画の読み込みは WebM を読めないので、作り直そうとしても必ず失敗する
 * （失敗のまま印が付かないと、YouTube に上げるのを、ずっと待ってしまう）
 */
export function canTranscode(m: Pick<Media, 'type'>, ios = isIosApp): boolean {
  return !(ios && m.type.includes('webm'))
}

/** アプリのファイルに置いた動画・写真の大きさの合計（設定の使用量に出す） */
export async function contentFilesSize(): Promise<number> {
  if (!usesFiles) return 0
  let total = 0
  await db.media.each((m) => {
    if (m.file) total += m.size
  })
  return total
}

/**
 * ファイルを書き換える処理は1つずつ順に行う（同じファイルを2か所から同時に書いたり、書いている途中で消したりしないように）。
 * 失敗しても reject しない（失敗した中身は IndexedDB に残り、次に起動したときにまた試す）
 */
let queue: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task).catch(() => {})
  queue = run
  return run
}

/**
 * アプリでは、IndexedDB に入った中身（blob）をファイルに移し、IndexedDB からは消す。
 * 記録を保存したあと・起動したときに呼ぶ（ids を省くと、全部を見る）
 */
export function moveContentsToFiles(ids?: string[]): Promise<void> {
  if (!usesFiles) return Promise.resolve()
  return enqueue(() => moveNow(ids))
}

/**
 * アプリで、ファイルの動画を決めた画質にそろえる（アルバムの大きな動画を軽くする・日がたった高画質の動画を軽くする）。
 * 起動したとき・記録を保存したあと・設定を変えたときに呼ぶ（ids を省くと、全部を見る）
 */
export function optimizeVideos(ids?: string[]): Promise<void> {
  if (!usesFiles) return Promise.resolve()
  return enqueue(() => optimizeNow(ids))
}

async function optimizeNow(ids?: string[]) {
  const settings = await getVideoSettings()
  const now = Date.now()
  const targets = ids ?? ((await db.media.filter((m) => m.type.startsWith('video/') && !!m.file).primaryKeys()) as string[])
  for (const id of targets) {
    const m = await db.media.get(id)
    if (!m?.file || !m.type.startsWith('video/')) continue
    const quality = targetQuality(m, settings, now)
    if (m.optimized === quality) continue
    // 作り直せない動画は、そのまま使う（作り直し済みの印を付けて、YouTube に上げられるようにする）
    if (!canTranscode(m)) {
      await db.media.update(id, { optimized: quality })
      continue
    }
    const source = m.file
    const out = optimizedPath(m, quality)
    let result: { skipped: boolean; size?: number }
    try {
      result = await transcodeVideoFile(source, out, QUALITY[quality])
    } catch (e) {
      // 作り直す仕組みが入っていない（古いアプリなど）ときは、印を付けずにやめる（入ったらそろえる）
      if ((e as { code?: string } | null)?.code === 'UNIMPLEMENTED') return
      console.warn('動画の画質をそろえられませんでした', id, e)
      // アプリが裏に回ったなどで止まったのかもしれないので、次に起動したときにまた試す。
      // 何度も失敗する動画（端末が読めない形式など）は、元のまま使う（YouTube にもそのまま上げる）
      const tries = (m.optimizeTries ?? 0) + 1
      await db.media.update(id, tries >= MAX_OPTIMIZE_TRIES ? { optimized: m.optimized ?? quality } : { optimizeTries: tries })
      continue
    }
    // 作り直しても軽くならなければ（もともと軽い動画）、元のまま使う
    if (!result.skipped && result.size !== undefined && result.size >= m.size) {
      await deleteFile(out)
      result = { skipped: true }
    }
    const swapped = await db.transaction('rw', db.media, async () => {
      const current = await db.media.get(id)
      // 作り直しているあいだに、中身が差し替わった・消されたなら、作ったファイルは使わない
      if (!current || current.file !== source) return false
      // 中身はこの端末だけのものなので、同期の対象にしない（updatedAt も変えない）
      await db.media.update(
        id,
        result.skipped ? { optimized: quality } : { file: out, size: result.size ?? current.size, optimized: quality },
      )
      return true
    })
    if (!result.skipped && !swapped) await deleteFile(out)
  }
}

/** 動画・写真のファイルを全部消してから、IndexedDB に残っている中身をファイルに移し直す（バックアップから戻した・すべて削除したとき） */
export function resetContentFiles(): Promise<void> {
  if (!usesFiles) return Promise.resolve()
  return enqueue(async () => {
    await deleteAllContentFiles()
    await moveNow()
  })
}

/**
 * 起動時に、この端末の行の使われていないファイル（差し替える前の中身・書きかけ）を片付ける
 * （書いている途中・消す直前にアプリが止められると残る）。
 * 中身の無い行の本来のファイルなら、消さずにつなぎ直す（画面の中の保存場所が消え、同期やバックアップで行だけ戻ったとき）。
 * まだ行の無いファイルは消さない（あとで同期などで行が戻ってきたら、つなぎ直せるように）
 */
export function tidyContentFiles(): Promise<void> {
  if (!usesFiles) return Promise.resolve()
  return enqueue(sweepNow)
}

async function sweepNow() {
  const known = new Set<string>()
  const used = new Set<string>()
  const relinkable = new Map<string, string>()
  await db.media.each((m) => {
    known.add(m.id)
    if (m.file) used.add(m.file)
    else if (!m.blob) relinkable.set(contentPath(m), m.id)
  })
  for (const path of await listContentFiles()) {
    if (used.has(path)) continue
    const id = relinkable.get(path)
    if (id) await db.media.update(id, { file: path })
    else if (known.has(contentIdOf(path) ?? '')) await deleteFile(path)
  }
}

async function moveNow(ids?: string[]) {
  const targets = ids ?? ((await db.media.filter((m) => !!m.blob).primaryKeys()) as string[])
  for (const id of targets) {
    try {
      // 順番を待つあいだに変わっているかもしれないので、移す直前に読む
      const m = await db.media.get(id)
      if (!m?.blob) continue
      const path = contentPath(m)
      await writeBlobFile(path, m.blob)
      const moved = await db.transaction('rw', db.media, async () => {
        // 書いているあいだに、中身が差し替わった（切り取ったなど）・消されたなら、書いたファイルは使わない
        const current = await db.media.get(id)
        if (!current?.blob || contentPath(current) !== path) return false
        // 中身はこの端末だけのものなので、同期の対象にしない（updatedAt も変えない）
        // 中身を差し替えたときの前のファイルは、下の watchContentFiles が消す
        await db.media.update(id, { file: path, blob: undefined })
        return true
      })
      if (!moved) await deleteFile(path)
    } catch {
      // 空きが足りないなどで書けなければ、IndexedDB に残して次の起動でまた試す（書きかけのファイルは起動時に片付ける）
    }
  }
}

/**
 * 動画・写真の行を消したり、中身を外したり差し替えたりしたら、そのファイルも消す（アプリだけ）。
 * 消す場所（記録の削除・型や分野の削除・整理・同期で消えた行など）ごとに書かなくて済むよう、行の変更を見て消す。
 * 書き込みが取り消されたときは消さない（書き込みが終わってから消す）
 */
export function watchContentFiles() {
  if (!usesFiles) return
  db.media.hook('deleting', (_key, obj, trans) => {
    const old = obj?.file
    if (old) trans.on('complete', () => void deleteFile(old))
  })
  db.media.hook('updating', (mods, _key, obj, trans) => {
    const old = obj?.file
    if (old && 'file' in mods && (mods as { file?: string }).file !== old) {
      trans.on('complete', () => void deleteFile(old))
    }
  })
}

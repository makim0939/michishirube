import type { Media } from '../domain/types'
import { db } from './db'
import { deleteAllContentFiles, deleteFile, listContentFiles, readBlobFile, usesFiles, writeBlobFile } from './files'

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
  if (m.file) return readBlobFile(m.file, m.type)
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

/** 動画・写真のファイルを全部消してから、IndexedDB に残っている中身をファイルに移し直す（バックアップから戻した・すべて削除したとき） */
export function resetContentFiles(): Promise<void> {
  if (!usesFiles) return Promise.resolve()
  return enqueue(async () => {
    await deleteAllContentFiles()
    await moveNow()
  })
}

/**
 * 起動時に、どの行からも使われていないファイルを片付ける（書いている途中・消す直前にアプリが止められると残る）。
 * 中身の無い行の本来のファイルなら、消さずにつなぎ直す（画面の中の保存場所が消え、同期やバックアップで行だけ戻ったとき）
 */
export function tidyContentFiles(): Promise<void> {
  if (!usesFiles) return Promise.resolve()
  return enqueue(sweepNow)
}

async function sweepNow() {
  // 記録が1つも無い（入れ直した・消された直後の）端末では、同期で行が戻ってくるかもしれないので消さない
  if ((await db.records.count()) === 0) return
  const used = new Set<string>()
  const relinkable = new Map<string, string>()
  await db.media.each((m) => {
    if (m.file) used.add(m.file)
    else if (!m.blob) relinkable.set(contentPath(m), m.id)
  })
  for (const path of await listContentFiles()) {
    if (used.has(path)) continue
    const id = relinkable.get(path)
    if (id) await db.media.update(id, { file: path })
    else await deleteFile(path)
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

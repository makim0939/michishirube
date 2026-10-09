import { Unzip, UnzipInflate, Zip, ZipPassThrough, strFromU8, strToU8 } from 'fflate'
import type { Domain, Media, PracticeRecord, Skill } from '../domain/types'
import { db, type Meta } from './db'

/**
 * バックアップは ZIP 1つ：data.json と media/ 以下の動画・写真。
 * 動画は数十MB単位になるので、1ファイルずつストリームで読み書きしてメモリに全部載せない。
 */

const FORMAT = 'michishirube-backup'
const VERSION = 1

interface BackupMedia extends Omit<Media, 'blob'> {
  path: string | null
}

interface BackupData {
  format: typeof FORMAT
  version: typeof VERSION
  exportedAt: number
  domains: Domain[]
  skills: Skill[]
  records: PracticeRecord[]
  media: BackupMedia[]
  meta: Meta[]
}

export class BackupError extends Error {}

const EXT_BY_TYPE: Record<string, string> = {
  'video/quicktime': '.mov',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

function extension(m: Pick<Media, 'type' | 'name'>): string {
  const fromType = EXT_BY_TYPE[m.type]
  if (fromType) return fromType
  const fromName = m.name?.match(/\.[a-z0-9]{1,5}$/i)?.[0]
  return fromName ? fromName.toLowerCase() : '.bin'
}

/** 中身を Blob にまとめる。チャンクを一定量ごとに Blob 化して、ブラウザがディスクへ逃がせるようにする */
class BlobSink {
  private parts: Blob[] = []
  private pending: Uint8Array<ArrayBuffer>[] = []
  private pendingSize = 0

  push(chunk: Uint8Array) {
    this.pending.push(chunk as Uint8Array<ArrayBuffer>)
    this.pendingSize += chunk.length
    if (this.pendingSize > 32 * 1024 * 1024) this.flush()
  }

  flush() {
    if (this.pending.length === 0) return
    this.parts.push(new Blob(this.pending))
    this.pending = []
    this.pendingSize = 0
  }

  toBlob(type: string): Blob {
    this.flush()
    return new Blob(this.parts, { type })
  }
}

async function pipeBlob(blob: Blob, onChunk: (chunk: Uint8Array, final: boolean) => void) {
  const reader = blob.stream().getReader()
  let prev: Uint8Array | undefined
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (prev) onChunk(prev, false)
    prev = value
  }
  onChunk(prev ?? new Uint8Array(0), true)
}

export async function estimateBackupSize(includeMedia: boolean): Promise<number> {
  if (!includeMedia) return 0
  let total = 0
  await db.media.each((m) => {
    total += m.size
  })
  return total
}

/**
 * ZIP 1つあたりの上限。fflate は ZIP64 を書けないので 4GB を超えると壊れる。
 * 余裕を持たせ、スマホのメモリにも優しい大きさで分割する
 */
export const PART_LIMIT = 1.5 * 1024 ** 3

class ZipWriter {
  private sink = new BlobSink()
  private error: Error | null = null
  private zip = new Zip((err, chunk) => {
    if (err) this.error = err
    else {
      this.sink.push(chunk)
      this.size += chunk.length
    }
  })
  size = 0
  mediaCount = 0

  addText(name: string, text: string) {
    const entry = new ZipPassThrough(name)
    this.zip.add(entry)
    entry.push(strToU8(text), true)
  }

  async addMedia(name: string, blob: Blob) {
    // 動画や写真はすでに圧縮済みなので、無圧縮で格納する
    const entry = new ZipPassThrough(name)
    this.zip.add(entry)
    await pipeBlob(blob, (chunk, final) => entry.push(chunk, final))
    this.mediaCount += 1
  }

  finish(): Blob {
    this.zip.end()
    if (this.error) throw this.error
    return this.sink.toBlob('application/zip')
  }
}

export interface BackupPart {
  blob: Blob
  name: string
}

export async function exportBackup(opts: {
  includeMedia: boolean
  partLimit?: number
  now?: Date
}): Promise<BackupPart[]> {
  const partLimit = opts.partLimit ?? PART_LIMIT
  const [domains, skills, records, media, meta] = await Promise.all([
    db.domains.toArray(),
    db.skills.toArray(),
    db.records.toArray(),
    db.media.toArray(),
    db.meta.toArray(),
  ])
  const rows: BackupMedia[] = media.map(({ blob: _blob, ...rest }) => ({
    ...rest,
    path: opts.includeMedia ? `media/${rest.id}${extension(rest)}` : null,
  }))
  const data: BackupData = {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    domains,
    skills,
    records,
    media: rows,
    meta,
  }

  // data.json は1つ目に入れ、動画・写真は上限を超えないように次の ZIP へ送る
  const blobs: Blob[] = []
  let writer = new ZipWriter()
  writer.addText('data.json', JSON.stringify(data, null, 2))
  for (let i = 0; i < media.length; i++) {
    const path = rows[i].path
    if (!path) continue
    if (writer.mediaCount > 0 && writer.size + media[i].size > partLimit) {
      blobs.push(writer.finish())
      writer = new ZipWriter()
    }
    await writer.addMedia(path, media[i].blob)
  }
  blobs.push(writer.finish())

  const base = backupFileName(opts.includeMedia, opts.now)
  return blobs.map((blob, i) => ({
    blob,
    name: blobs.length === 1 ? `${base}.zip` : `${base}-${i + 1}of${blobs.length}.zip`,
  }))
}

function parseBackupData(text: string): BackupData {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupError('data.json を読み込めませんでした')
  }
  const d = data as Partial<BackupData>
  if (d.format !== FORMAT) throw new BackupError('道しるべのバックアップファイルではありません')
  if (d.version !== VERSION) throw new BackupError(`未対応のバックアップ形式です（version ${String(d.version)}）`)
  for (const key of ['domains', 'skills', 'records', 'media', 'meta'] as const) {
    if (!Array.isArray(d[key])) throw new BackupError(`バックアップの ${key} が壊れています`)
  }
  return d as BackupData
}

async function readZip(file: Blob): Promise<Map<string, Blob>> {
  const files = new Map<string, Blob>()
  const pending: Promise<void>[] = []
  const unzip = new Unzip((entry) => {
    const chunks: Uint8Array<ArrayBuffer>[] = []
    pending.push(
      new Promise<void>((resolve, reject) => {
        entry.ondata = (err, data, final) => {
          if (err) return reject(err)
          chunks.push(data as Uint8Array<ArrayBuffer>)
          if (final) {
            files.set(entry.name, new Blob(chunks))
            resolve()
          }
        }
      }),
    )
    entry.start()
  })
  unzip.register(UnzipInflate)
  await pipeBlob(file, (chunk, final) => unzip.push(chunk, final))
  await Promise.all(pending)
  return files
}

export interface ImportSummary {
  domains: number
  skills: number
  records: number
  media: number
  missingMedia: number
}

/** バックアップで全データを置き換える。分割されたバックアップは全部まとめて渡す */
export async function importBackup(zips: Blob[]): Promise<ImportSummary> {
  const files = new Map<string, Blob>()
  let dataFile: Blob | undefined
  for (const zip of zips) {
    let entries: Map<string, Blob>
    try {
      entries = await readZip(zip)
    } catch {
      throw new BackupError('ZIP ファイルとして読み込めませんでした')
    }
    for (const [name, blob] of entries) {
      if (name !== 'data.json') files.set(name, blob)
      else if (dataFile) throw new BackupError('別々のバックアップが混ざっています。1回分の ZIP だけを選んでください')
      else dataFile = blob
    }
  }
  if (!dataFile) throw new BackupError('バックアップに data.json がありません（分割されている場合は、1つ目の ZIP も選んでください）')
  const data = parseBackupData(strFromU8(new Uint8Array(await dataFile.arrayBuffer())))

  const media: Media[] = []
  const mediaIds = new Set<string>()
  for (const { path, ...m } of data.media) {
    const content = path ? files.get(path) : undefined
    if (!content) continue
    media.push({ ...m, blob: new Blob([content], { type: m.type }) })
    mediaIds.add(m.id)
  }
  // 写真・動画を含めずに書き出したバックアップでは、記録からメディアへの参照を外しておく
  const records = data.records.map((r) => ({ ...r, mediaIds: r.mediaIds.filter((id) => mediaIds.has(id)) }))

  await db.transaction('rw', [db.domains, db.skills, db.records, db.media, db.meta], async () => {
    await Promise.all([db.domains.clear(), db.skills.clear(), db.records.clear(), db.media.clear(), db.meta.clear()])
    await db.domains.bulkAdd(data.domains)
    await db.skills.bulkAdd(data.skills)
    await db.records.bulkAdd(records)
    await db.media.bulkAdd(media)
    await db.meta.bulkPut([...data.meta, { key: 'seeded', value: true }])
  })

  return {
    domains: data.domains.length,
    skills: data.skills.length,
    records: records.length,
    media: media.length,
    missingMedia: data.media.length - media.length,
  }
}

function backupFileName(includeMedia: boolean, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `michishirube-${includeMedia ? 'full' : 'notes'}-${stamp}`
}

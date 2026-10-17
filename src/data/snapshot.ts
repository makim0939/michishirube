import { withoutLegacySkillFields } from '../../shared/protocol'
import type { Domain, Media, PracticeRecord, Skill } from '../domain/types'
import { db, type Meta } from './db'
import { readTextFile, usesFiles, writeTextFile } from './files'

/**
 * 記録の写し（アプリだけ）。分野・型・記録・動画と写真の情報・設定を、アプリのファイル（snapshot.json）にも書いておく。
 * 画面の中の保存場所（IndexedDB）が OS に消されても、次に開いたときにこの写しから戻す。
 * 動画・写真の中身はもともとファイルにあるので、写しには含めない（サムネイルは中身から作り直せる）。
 * 同期の接続先などこの端末だけの設定も入れる（戻したあとも同期が続くように）。写しはアプリの中にだけあり、
 * 書き出すバックアップ（ZIP）とは違って端末の外には出ない
 */

const PATH = 'snapshot.json'
/** 書き込みが続いたら、落ち着いてからまとめて1回書く */
const WAIT_MS = 1500

export interface Snapshot {
  version: 1
  at: number
  domains: Domain[]
  skills: Skill[]
  records: PracticeRecord[]
  media: Media[]
  meta: Meta[]
}

/** 写しに入れる形。動画・写真の中身とサムネイル（画像）は入れない */
export function toSnapshot(
  data: Omit<Snapshot, 'version' | 'at' | 'media'> & { media: Media[] },
  at: number,
): Snapshot {
  return {
    version: 1,
    at,
    ...data,
    media: data.media.map(({ blob: _blob, poster: _poster, ...rest }) => rest),
  }
}

export function parseSnapshot(text: string | undefined): Snapshot | undefined {
  if (!text) return undefined
  try {
    const s = JSON.parse(text) as Snapshot
    if (s.version !== 1 || !Array.isArray(s.domains) || !Array.isArray(s.records)) return undefined
    return s
  } catch {
    return undefined
  }
}

async function readAll() {
  const [domains, skills, records, media, meta] = await Promise.all([
    db.domains.toArray(),
    db.skills.toArray(),
    db.records.toArray(),
    db.media.toArray(),
    db.meta.toArray(),
  ])
  return { domains, skills, records, media, meta }
}

async function writeSnapshot() {
  await writeTextFile(PATH, JSON.stringify(toSnapshot(await readAll(), Date.now())))
}

let timer: ReturnType<typeof setTimeout> | undefined
let writing: Promise<void> = Promise.resolve()

/** 前の書き込みが終わってから書く（同じ一時ファイルに同時に書かない） */
function enqueueWrite(): Promise<void> {
  const run = writing.then(writeSnapshot)
  writing = run.catch(() => {
    // 書けなくても、次の変更でまた書く
  })
  return run
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(() => void enqueueWrite().catch(() => {}), WAIT_MS)
}

/** 待たずに今すぐ書く（すべて削除したあとなど、次に開いたときに古い写しから戻らないように） */
export function saveSnapshotNow(): Promise<void> {
  if (!usesFiles) return Promise.resolve()
  clearTimeout(timer)
  return enqueueWrite()
}

/** 変更があるたびに写しを書き直す（アプリだけ）。起動して、写しから戻したあとに呼ぶ */
export function watchSnapshot() {
  if (!usesFiles) return
  for (const table of [db.domains, db.skills, db.records, db.media, db.meta]) {
    table.hook('creating', schedule)
    table.hook('updating', schedule)
    table.hook('deleting', schedule)
  }
  // まだ写しが無いときのために、起動時にも1回書く
  schedule()
}

/**
 * 画面の中の保存場所が空なのに写しがあれば（OS に消された）、写しから戻す。戻したら true。
 * クラウド同期をつないでいれば、戻した内容を送り直す（消える前に送れていなかった変更があっても届くように）
 */
export async function restoreSnapshotIfEmpty(): Promise<boolean> {
  if (!usesFiles) return false
  const [domains, records] = await Promise.all([db.domains.count(), db.records.count()])
  if (domains > 0 || records > 0) return false
  // 入れ替えの途中で止まっていたら、一時ファイルのほうを使う
  const snapshot = parseSnapshot(await readTextFile(PATH)) ?? parseSnapshot(await readTextFile(`${PATH}.tmp`))
  if (!snapshot || (snapshot.domains.length === 0 && snapshot.records.length === 0)) return false
  await db.transaction('rw', [db.domains, db.skills, db.records, db.media, db.meta, db.outbox], async () => {
    await db.domains.bulkPut(snapshot.domains)
    await db.skills.bulkPut(snapshot.skills.map((s) => withoutLegacySkillFields(s)))
    await db.records.bulkPut(snapshot.records)
    await db.media.bulkPut(snapshot.media)
    await db.meta.bulkPut(snapshot.meta)
    const at = Date.now()
    await db.outbox.bulkPut([
      ...snapshot.domains.map((d) => ({ kind: 'domain' as const, id: d.id, at })),
      ...snapshot.skills.map((s) => ({ kind: 'skill' as const, id: s.id, at })),
      ...snapshot.records.map((r) => ({ kind: 'record' as const, id: r.id, at })),
      ...snapshot.media.map((m) => ({ kind: 'media' as const, id: m.id, at })),
      { kind: 'settings' as const, id: 'settings', at },
    ])
  })
  return true
}

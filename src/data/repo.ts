import { newlyUnlocked, practicingFrom, PRACTICING_DAYS, wouldCreateCycle } from '../domain/logic'
import { isWebUrl, parseTemplate, templateToEntities, type RoadmapTemplate } from '../domain/template'
import type { Media, Outcome, PracticeRecord, Reference, Skill } from '../domain/types'
import latteArt from '../roadmaps/latte-art.json'
import { moveContentsToFiles, optimizeVideos } from './content'
import { db, markDirty, newId } from './db'
import type { VideoQuality, YoutubePrivacy } from './videoStorage'

export const BUNDLED_TEMPLATES: RoadmapTemplate[] = [parseTemplate(latteArt)]

export class RepoError extends Error {}

/**
 * 書き込みはすべて、updatedAt を進めて outbox に印を付ける（サーバーへ送る対象になる）。
 * そのため、トランザクションには必ず db.outbox も含める
 */

// ---- 初回 ----

/**
 * 初回起動時だけラテアートのロードマップを入れる。削除後に勝手に復活させないよう印を残す。
 * 初期データは updatedAt を 0 にしておき、別の端末で進めた内容と同期したときに必ず負けるようにする
 */
export async function ensureSeeded() {
  await db.transaction('rw', [db.domains, db.skills, db.meta, db.outbox], async () => {
    if (await db.meta.get('seeded')) return
    if ((await db.domains.count()) === 0) {
      for (const t of BUNDLED_TEMPLATES) await addTemplate(t, 0)
    }
    await db.meta.put({ key: 'seeded', value: true })
  })
}

// ---- ロードマップ ----

export async function importTemplate(json: unknown): Promise<string> {
  const t = parseTemplate(json)
  return db.transaction('rw', [db.domains, db.skills, db.outbox], () => addTemplate(t, Date.now()))
}

async function addTemplate(t: RoadmapTemplate, updatedAt: number): Promise<string> {
  const order = (await db.domains.count()) + 1
  const { domain, skills } = templateToEntities(t, { now: Date.now(), updatedAt, order, newId })
  await db.domains.add(domain)
  await db.skills.bulkAdd(skills)
  await markDirty('domain', [domain.id])
  await markDirty(
    'skill',
    skills.map((s) => s.id),
  )
  return domain.id
}

export async function createDomain(name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw new RepoError('分野の名前を入れてください')
  const id = newId()
  await db.transaction('rw', db.domains, db.outbox, async () => {
    const now = Date.now()
    await db.domains.add({ id, name: trimmed, order: (await db.domains.count()) + 1, createdAt: now, updatedAt: now })
    await markDirty('domain', [id])
  })
  return id
}

export async function renameDomain(id: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) throw new RepoError('分野の名前を入れてください')
  await db.transaction('rw', db.domains, db.outbox, async () => {
    await db.domains.update(id, { name: trimmed, updatedAt: Date.now() })
    await markDirty('domain', [id])
  })
}

/**
 * 型の記録と動画・写真を消す（型・分野の削除で共通。型そのものは呼び出し側が消す）。
 * 自分ではトランザクションを張らない。呼び出し側が records・media・outbox を含めて張ること
 * （削除と「削除の印」が、別々に確定しないように）
 */
async function deleteRecordsOfSkills(skillIds: string[]) {
  const recordIds = (await db.records.where('skillId').anyOf(skillIds).primaryKeys()) as string[]
  const mediaIds = (await db.media.where('skillId').anyOf(skillIds).primaryKeys()) as string[]
  await db.media.bulkDelete(mediaIds)
  await db.records.bulkDelete(recordIds)
  await markDirty('media', mediaIds)
  await markDirty('record', recordIds)
}

export async function deleteDomain(id: string) {
  await db.transaction('rw', [db.domains, db.skills, db.records, db.media, db.outbox], async () => {
    const skillIds = (await db.skills.where('domainId').equals(id).toArray()).map((s) => s.id)
    await deleteRecordsOfSkills(skillIds)
    await db.skills.bulkDelete(skillIds)
    await db.domains.delete(id)
    await markDirty('skill', skillIds)
    await markDirty('domain', [id])
  })
}

export interface SkillInput {
  name: string
  description: string
  prereqIds: string[]
}

function cleanInput(input: SkillInput): SkillInput {
  const name = input.name.trim()
  if (!name) throw new RepoError('型の名前を入れてください')
  return {
    name,
    description: input.description.trim(),
    prereqIds: [...new Set(input.prereqIds)],
  }
}

export async function createSkill(domainId: string, input: SkillInput): Promise<string> {
  const clean = cleanInput(input)
  const id = newId()
  await db.transaction('rw', db.skills, db.outbox, async () => {
    const now = Date.now()
    await db.skills.add({ id, domainId, ...clean, references: [], status: 'idle', createdAt: now, updatedAt: now })
    await markDirty('skill', [id])
  })
  return id
}

export async function updateSkill(id: string, input: SkillInput) {
  const clean = cleanInput(input)
  await db.transaction('rw', db.skills, db.outbox, async () => {
    const skills = await db.skills.toArray()
    if (clean.prereqIds.includes(id) || wouldCreateCycle(id, clean.prereqIds, skills)) {
      throw new RepoError('前提が循環してしまいます')
    }
    await db.skills.update(id, (s) => void Object.assign(s, clean, { updatedAt: Date.now() }))
    await markDirty('skill', [id])
  })
}

export async function deleteSkill(id: string) {
  await db.transaction('rw', [db.skills, db.records, db.media, db.outbox], async () => {
    await deleteRecordsOfSkills([id])
    await db.skills.delete(id)
    await markDirty('skill', [id])
    const now = Date.now()
    const dependents = (await db.skills.toArray()).filter((s) => s.prereqIds.includes(id))
    for (const s of dependents) {
      await db.skills.update(s.id, { prereqIds: s.prereqIds.filter((p) => p !== id), updatedAt: now })
    }
    await markDirty(
      'skill',
      dependents.map((s) => s.id),
    )
  })
}

// ---- 参考資料 ----

export async function addReference(skillId: string, input: { url: string; title?: string; note?: string }) {
  const url = input.url.trim()
  if (!isWebUrl(url)) throw new RepoError('URL は http:// か https:// で始めてください')
  const reference: Reference = {
    id: newId(),
    url,
    title: input.title?.trim() || defaultReferenceTitle(url),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  }
  await db.transaction('rw', db.skills, db.outbox, async () => {
    const skill = await db.skills.get(skillId)
    if (!skill) throw new RepoError('型が見つかりません')
    await db.skills.update(skillId, { references: [...skill.references, reference], updatedAt: Date.now() })
    await markDirty('skill', [skillId])
  })
}

export async function removeReference(skillId: string, referenceId: string) {
  await db.transaction('rw', db.skills, db.outbox, async () => {
    const skill = await db.skills.get(skillId)
    if (!skill) return
    await db.skills.update(skillId, {
      references: skill.references.filter((r) => r.id !== referenceId),
      updatedAt: Date.now(),
    })
    await markDirty('skill', [skillId])
  })
}

/** タイトルを書かなかったときの名前。YouTube などはサービス名、それ以外はドメイン名 */
function defaultReferenceTitle(url: string): string {
  const host = new URL(url).hostname.replace(/^www\.|^m\./, '')
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YouTube の動画'
  if (host.endsWith('instagram.com')) return 'Instagram の投稿'
  return host
}

// ---- 挑戦・達成 ----

async function setSkill(id: string, patch: Partial<Skill>) {
  await db.skills.update(id, { ...patch, updatedAt: Date.now() })
  await markDirty('skill', [id])
}

/**
 * 練習中の型（最近記録した型）の id。自分で出し入れせず、記録から決める。
 * 最近の記録が無ければ、最後に記録した型を練習中にする（久しぶりに開いても、続きからすぐ記録できるように）
 */
export async function practicingSkillIds(now = Date.now()): Promise<Set<string>> {
  const since = now - PRACTICING_DAYS * 24 * 60 * 60 * 1000
  const recent = await db.records.where('createdAt').aboveOrEqual(since).toArray()
  const last = recent.length > 0 ? undefined : await db.records.orderBy('createdAt').last()
  return practicingFrom(recent, last)
}

/**
 * 記録のある型の id。
 * iPhone の Safari は、記録が0件のときに重複なしのカーソル（uniqueKeys）を開けずに落ちるので、キーを全部読んでまとめる
 */
export async function recordedSkillIds(): Promise<Set<string>> {
  return new Set((await db.records.orderBy('skillId').keys()) as string[])
}

/** 達成にして、達成を目指せるようになったスキルを返す（解除演出に使う） */
export async function achieveSkill(id: string): Promise<{ skill: Skill; unlocked: Skill[] }> {
  return db.transaction('rw', db.skills, db.outbox, async () => {
    const skills = await db.skills.toArray()
    const skill = skills.find((s) => s.id === id)
    if (!skill) throw new RepoError('型が見つかりません')
    // 前提はおすすめの順なので、前提がまだでも「できた」にできる
    if (skill.status === 'done') throw new RepoError('すでにできています')
    const unlocked = newlyUnlocked(id, skills)
    await setSkill(id, { status: 'done', achievedAt: Date.now(), activatedAt: undefined })
    return { skill: { ...skill, status: 'done' as const }, unlocked }
  })
}

export async function revertAchievement(id: string) {
  await db.transaction('rw', db.skills, db.outbox, () => setSkill(id, { status: 'idle', achievedAt: undefined }))
}

// ---- 記録 ----

/** 記録に付ける動画・写真。動画には一覧用のサムネイルを添えられる */
export interface NewMedia {
  blob: Blob
  poster?: Blob
  /** poster が最後のコマ（できあがり）か。作れずに最初のコマにしたときは false */
  posterEnd?: boolean
  /** 撮るときに選んだ画質・YouTube の公開範囲（この動画だけ。省くと設定のとおり） */
  quality?: VideoQuality
  youtubePrivacy?: YoutubePrivacy
}

export interface RecordInput {
  skillId: string
  outcome?: Outcome
  reason: string
  causes?: string[]
  nextAction: string
  files: (Blob | NewMedia)[]
}

function asNewMedia(f: Blob | NewMedia): NewMedia {
  return f instanceof Blob ? { blob: f } : f
}

/** 中身を差し替えたときの項目。動画は YouTube に上げ直す */
function contentFields(m: NewMedia, now: number): Partial<Media> {
  const type = m.blob.type || 'application/octet-stream'
  return {
    contentAt: now,
    // 中身が変わったので、画質をそろえ直す
    optimized: undefined,
    optimizeTries: undefined,
    blob: m.blob,
    poster: m.poster,
    type,
    name: m.blob instanceof File ? m.blob.name : undefined,
    size: m.blob.size,
    // 動画は YouTube へ、写真はサーバーへ。どちらも連携していれば自動で送る
    ...(type.startsWith('video/')
      ? {
          upload: 'pending' as const,
          youtubeId: undefined,
          uploadError: undefined,
          uploadAttempts: undefined,
          // 撮ったときに作ったサムネイルは、できあがりのコマ。中身が変わったらサーバーにも置き直す
          posterEnd: !!m.poster && m.posterEnd !== false,
          cloudPoster: false,
          cloudPosterEnd: false,
        }
      : { cloudPhoto: false }),
  }
}

function newMediaRows(recordId: string, skillId: string, files: NewMedia[], now: number): Media[] {
  return files.map((m, i) => ({
    id: newId(),
    recordId,
    skillId,
    createdAt: now + i,
    updatedAt: now,
    ...(contentFields(m, now) as Pick<Media, 'type' | 'size'>),
    ...(m.quality ? { quality: m.quality } : {}),
    ...(m.youtubePrivacy ? { youtubePrivacy: m.youtubePrivacy } : {}),
  }))
}

export async function addRecord(input: RecordInput): Promise<string> {
  const reason = input.reason.trim()
  const nextAction = input.nextAction.trim()
  const causes = input.causes ?? []
  if (!reason && !nextAction && causes.length === 0 && input.files.length === 0 && !input.outcome) {
    throw new RepoError('動画・写真か、メモを1つ以上入れてください')
  }
  const now = Date.now()
  const recordId = newId()
  const media = newMediaRows(recordId, input.skillId, input.files.map(asNewMedia), now)
  const record: PracticeRecord = {
    id: recordId,
    skillId: input.skillId,
    createdAt: now,
    updatedAt: now,
    ...(input.outcome ? { outcome: input.outcome } : {}),
    reason,
    ...(causes.length > 0 ? { causes } : {}),
    nextAction,
    mediaIds: media.map((m) => m.id),
  }
  await db.transaction('rw', db.records, db.media, db.outbox, async () => {
    await db.media.bulkAdd(media)
    await db.records.add(record)
    await markDirty(
      'media',
      media.map((m) => m.id),
    )
    await markDirty('record', [recordId])
  })
  // アプリでは、動画・写真をアプリのファイルに移す（画面の中の保存場所は OS に消されることがあるため）。
  // 移し終わるのは待たない（起動時の移しが続いていても、保存はすぐ終える）
  void moveContentsToFiles(media.map((m) => m.id))
  void optimizeVideos(media.map((m) => m.id))
  return recordId
}

export interface RecordUpdate {
  recordId: string
  /** 型を付け替えるとき（練習の途中で、描く型を変えたなど）。省くと、いまの型のまま */
  skillId?: string
  outcome?: Outcome
  reason: string
  causes?: string[]
  nextAction: string
  /** 足す動画・写真 */
  addFiles: NewMedia[]
  /** 外す動画・写真 */
  removeMediaIds: string[]
  /** 中身を差し替える（切り取った動画など） */
  replace: ({ id: string } & NewMedia)[]
}

/** 保存した記録を直す。結果・理由・次の一手と、動画・写真の追加・削除・差し替え */
export async function updateRecord(input: RecordUpdate) {
  const reason = input.reason.trim()
  const nextAction = input.nextAction.trim()
  let changed: string[] = []
  await db.transaction('rw', db.records, db.media, db.skills, db.outbox, async () => {
    const record = await db.records.get(input.recordId)
    if (!record) throw new RepoError('記録が見つかりません')
    const now = Date.now()
    const skillId = input.skillId ?? record.skillId
    if (skillId !== record.skillId && !(await db.skills.get(skillId))) throw new RepoError('型が見つかりません')
    const removed = new Set(input.removeMediaIds)
    const kept = record.mediaIds.filter((id) => !removed.has(id))
    const added = newMediaRows(record.id, skillId, input.addFiles, now)
    const causes = input.causes ?? []
    if (!reason && !nextAction && causes.length === 0 && !input.outcome && kept.length + added.length === 0) {
      throw new RepoError('動画・写真か、メモを1つ以上入れてください')
    }
    await db.media.bulkDelete([...removed])
    await db.media.bulkAdd(added)
    for (const r of input.replace) {
      if (removed.has(r.id)) continue
      await db.media.update(r.id, { ...contentFields(r, now), updatedAt: now })
    }
    // 型を付け替えたら、動画・写真も新しい型に移す（型の画面は、型の id で動画・写真を探すため）
    const moved = skillId !== record.skillId ? kept : []
    if (moved.length > 0) await db.media.where('id').anyOf(moved).modify({ skillId, updatedAt: now })
    await db.records.update(record.id, {
      skillId,
      outcome: input.outcome,
      reason,
      causes: causes.length > 0 ? causes : undefined,
      nextAction,
      mediaIds: [...kept, ...added.map((m) => m.id)],
      updatedAt: now,
    })
    await markDirty('media', [...removed, ...added.map((m) => m.id), ...input.replace.map((r) => r.id), ...moved])
    await markDirty('record', [record.id])
    changed = [...added.map((m) => m.id), ...input.replace.map((r) => r.id).filter((id) => !removed.has(id))]
  })
  // 足した・差し替えた動画・写真を、アプリのファイルに移す（アプリだけ。移し終わるのは待たない）
  void moveContentsToFiles(changed)
  void optimizeVideos(changed)
}

export async function deleteRecord(id: string) {
  await db.transaction('rw', db.records, db.media, db.outbox, async () => {
    const mediaIds = (await db.media.where('recordId').equals(id).primaryKeys()) as string[]
    await db.media.bulkDelete(mediaIds)
    await db.records.delete(id)
    await markDirty('media', mediaIds)
    await markDirty('record', [id])
  })
}

/**
 * 杯の通し番号（No.）。型に関係なく、全部の記録の中で古いほうから何杯目か。
 * これまでどれだけ練習したかが分かるよう、ラテ帳・今日の画面で同じ番号を使う
 */
export async function cupNumbers(records: PracticeRecord[]): Promise<Map<string, number>> {
  if (records.length === 0) return new Map()
  // 日時の索引の順（同じ日時なら id の順）に id だけを読み、何番目かを番号にする（記録の中身は読まない）。
  // 同じ日時の記録があっても、番号が重なったり飛んだりしない
  const order = (await db.records.orderBy('createdAt').primaryKeys()) as string[]
  const index = new Map(order.map((id, i) => [id, i + 1]))
  return new Map(records.map((r) => [r.id, index.get(r.id) ?? 0]))
}

export async function recordsOf(skillId: string): Promise<PracticeRecord[]> {
  return db.records
    .where('[skillId+createdAt]')
    .between([skillId, -Infinity], [skillId, Infinity])
    .reverse()
    .toArray()
}

/** 前回の「次の一手」。空の記録は飛ばして、最後に書かれたものを返す */
export async function lastNextAction(skillId: string): Promise<{ text: string; at: number } | undefined> {
  const records = await recordsOf(skillId)
  const hit = records.find((r) => r.nextAction)
  return hit && { text: hit.nextAction, at: hit.createdAt }
}

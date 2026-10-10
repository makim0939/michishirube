import { canActivate, newlyUnlocked, wouldCreateCycle } from '../domain/logic'
import { isWebUrl, parseTemplate, templateToEntities, type RoadmapTemplate } from '../domain/template'
import {
  DEFAULT_SETTINGS,
  MAX_ACTIVE_RANGE,
  type Media,
  type Outcome,
  type PracticeRecord,
  type Reference,
  type Settings,
  type Skill,
  type Source,
} from '../domain/types'
import latteArt from '../roadmaps/latte-art.json'
import { db, markDirty, newId } from './db'

export const BUNDLED_TEMPLATES: RoadmapTemplate[] = [parseTemplate(latteArt)]

export class RepoError extends Error {}

/**
 * 書き込みはすべて、updatedAt を進めて outbox に印を付ける（サーバーへ送る対象になる）。
 * そのため、トランザクションには必ず db.outbox も含める
 */

// ---- 設定 ----

export async function getSettings(): Promise<Settings> {
  const row = await db.meta.get('settings')
  return { ...DEFAULT_SETTINGS, ...(row?.value as Partial<Settings> | undefined) }
}

async function updateSettings(patch: Partial<Omit<Settings, 'updatedAt'>>) {
  await db.transaction('rw', db.meta, db.outbox, async () => {
    const current = await getSettings()
    await db.meta.put({ key: 'settings', value: { ...current, ...patch, updatedAt: Date.now() } })
    await markDirty('settings', ['settings'])
  })
}

export async function setMaxActive(n: number) {
  await updateSettings({ maxActive: Math.min(MAX_ACTIVE_RANGE.max, Math.max(MAX_ACTIVE_RANGE.min, Math.round(n))) })
}

export async function setAutoTidy(autoTidy: boolean) {
  await updateSettings({ autoTidy })
}

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

export async function deleteDomain(id: string) {
  await db.transaction('rw', [db.domains, db.skills, db.records, db.media, db.outbox], async () => {
    const skillIds = (await db.skills.where('domainId').equals(id).toArray()).map((s) => s.id)
    const recordIds = (await db.records.where('skillId').anyOf(skillIds).primaryKeys()) as string[]
    const mediaIds = (await db.media.where('skillId').anyOf(skillIds).primaryKeys()) as string[]
    await db.media.bulkDelete(mediaIds)
    await db.records.bulkDelete(recordIds)
    await db.skills.bulkDelete(skillIds)
    await db.domains.delete(id)
    await markDirty('media', mediaIds)
    await markDirty('record', recordIds)
    await markDirty('skill', skillIds)
    await markDirty('domain', [id])
  })
}

export interface SkillInput {
  name: string
  description: string
  criteria: string
  sources: Source[]
  prereqIds: string[]
}

function cleanInput(input: SkillInput): SkillInput {
  const name = input.name.trim()
  if (!name) throw new RepoError('スキルの名前を入れてください')
  for (const s of input.sources) {
    const url = s.url?.trim()
    if (url && !isWebUrl(url)) throw new RepoError(`出典の URL は http:// か https:// で始めてください（${url}）`)
  }
  return {
    name,
    description: input.description.trim(),
    criteria: input.criteria.trim(),
    sources: input.sources
      .map((s) => ({ title: s.title.trim(), ...(s.url?.trim() ? { url: s.url.trim() } : {}) }))
      .filter((s) => s.title || s.url)
      .map((s) => ({ ...s, title: s.title || s.url! })),
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
    const recordIds = (await db.records.where('skillId').equals(id).primaryKeys()) as string[]
    const mediaIds = (await db.media.where('skillId').equals(id).primaryKeys()) as string[]
    await db.media.bulkDelete(mediaIds)
    await db.records.bulkDelete(recordIds)
    await db.skills.delete(id)
    await markDirty('media', mediaIds)
    await markDirty('record', recordIds)
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
    if (!skill) throw new RepoError('スキルが見つかりません')
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
export function defaultReferenceTitle(url: string): string {
  const host = new URL(url).hostname.replace(/^www\.|^m\./, '')
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YouTube の動画'
  if (host.endsWith('instagram.com')) return 'Instagram の投稿'
  return host
}

// ---- 挑戦・達成 ----

const ACTIVATE_MESSAGES = {
  locked: '前提のスキルに、まだ挑戦していません',
  done: 'すでに達成しています',
  already: 'すでに挑戦中です',
  limit: '挑戦中の上限に達しています。どれかを達成するか、挑戦をやめてください',
} as const

async function setSkill(id: string, patch: Partial<Skill>) {
  await db.skills.update(id, { ...patch, updatedAt: Date.now() })
  await markDirty('skill', [id])
}

export async function activateSkill(id: string) {
  await db.transaction('rw', [db.skills, db.meta, db.outbox], async () => {
    const skills = await db.skills.toArray()
    const skill = skills.find((s) => s.id === id)
    if (!skill) throw new RepoError('スキルが見つかりません')
    const check = canActivate(skill, skills, (await getSettings()).maxActive)
    if (!check.ok) throw new RepoError(ACTIVATE_MESSAGES[check.reason])
    await setSkill(id, { status: 'active', activatedAt: Date.now() })
  })
}

export async function deactivateSkill(id: string) {
  await db.transaction('rw', db.skills, db.outbox, () => setSkill(id, { status: 'idle', activatedAt: undefined }))
}

/** 達成にして、達成を目指せるようになったスキルを返す（解除演出に使う） */
export async function achieveSkill(id: string): Promise<{ skill: Skill; unlocked: Skill[] }> {
  return db.transaction('rw', db.skills, db.outbox, async () => {
    const skills = await db.skills.toArray()
    const skill = skills.find((s) => s.id === id)
    if (!skill) throw new RepoError('スキルが見つかりません')
    if (skill.status === 'done') throw new RepoError('すでに達成しています')
    if (!skill.prereqIds.every((p) => skills.find((s) => s.id === p)?.status === 'done')) {
      throw new RepoError('前提のスキルをまだ達成していません')
    }
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
}

export interface RecordInput {
  skillId: string
  outcome?: Outcome
  reason: string
  nextAction: string
  files: (Blob | NewMedia)[]
}

function asNewMedia(f: Blob | NewMedia): NewMedia {
  return f instanceof Blob ? { blob: f } : f
}

/** 中身を差し替えたときの項目。動画は YouTube に上げ直す */
function contentFields(m: NewMedia): Partial<Media> {
  const type = m.blob.type || 'application/octet-stream'
  return {
    blob: m.blob,
    poster: m.poster,
    type,
    name: m.blob instanceof File ? m.blob.name : undefined,
    size: m.blob.size,
    // 動画は YouTube へ、写真はサーバーへ。どちらも連携していれば自動で送る
    ...(type.startsWith('video/')
      ? { upload: 'pending' as const, youtubeId: undefined, uploadError: undefined, uploadAttempts: undefined }
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
    ...(contentFields(m) as Pick<Media, 'type' | 'size'>),
  }))
}

export async function addRecord(input: RecordInput): Promise<string> {
  const reason = input.reason.trim()
  const nextAction = input.nextAction.trim()
  if (!reason && !nextAction && input.files.length === 0 && !input.outcome) {
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
  return recordId
}

export interface RecordUpdate {
  recordId: string
  outcome?: Outcome
  reason: string
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
  await db.transaction('rw', db.records, db.media, db.outbox, async () => {
    const record = await db.records.get(input.recordId)
    if (!record) throw new RepoError('記録が見つかりません')
    const now = Date.now()
    const removed = new Set(input.removeMediaIds)
    const kept = record.mediaIds.filter((id) => !removed.has(id))
    const added = newMediaRows(record.id, record.skillId, input.addFiles, now)
    if (!reason && !nextAction && !input.outcome && kept.length + added.length === 0) {
      throw new RepoError('動画・写真か、メモを1つ以上入れてください')
    }
    await db.media.bulkDelete([...removed])
    await db.media.bulkAdd(added)
    for (const r of input.replace) {
      if (removed.has(r.id)) continue
      await db.media.update(r.id, { ...contentFields(r), updatedAt: now })
    }
    await db.records.update(record.id, {
      outcome: input.outcome,
      reason,
      nextAction,
      mediaIds: [...kept, ...added.map((m) => m.id)],
      updatedAt: now,
    })
    await markDirty('media', [...removed, ...added.map((m) => m.id), ...input.replace.map((r) => r.id)])
    await markDirty('record', [record.id])
  })
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

/** 自動整理で端末から消さない印 */
export async function setMediaKeep(id: string, keep: boolean) {
  await db.transaction('rw', db.media, db.outbox, async () => {
    await db.media.update(id, { keep, updatedAt: Date.now() })
    await markDirty('media', [id])
  })
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

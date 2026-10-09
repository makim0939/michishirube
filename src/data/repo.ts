import { canActivate, invalidActives, newlyUnlocked, wouldCreateCycle } from '../domain/logic'
import { parseTemplate, templateToEntities, type RoadmapTemplate } from '../domain/template'
import {
  DEFAULT_SETTINGS,
  MAX_ACTIVE_RANGE,
  type Media,
  type Outcome,
  type PracticeRecord,
  type Settings,
  type Skill,
  type Source,
} from '../domain/types'
import latteArt from '../roadmaps/latte-art.json'
import { db, newId } from './db'

export const BUNDLED_TEMPLATES: RoadmapTemplate[] = [parseTemplate(latteArt)]

export class RepoError extends Error {}

// ---- 設定 ----

export async function getSettings(): Promise<Settings> {
  const row = await db.meta.get('settings')
  return { ...DEFAULT_SETTINGS, ...(row?.value as Partial<Settings> | undefined) }
}

export async function setMaxActive(n: number) {
  const value = Math.min(MAX_ACTIVE_RANGE.max, Math.max(MAX_ACTIVE_RANGE.min, Math.round(n)))
  const current = await getSettings()
  await db.meta.put({ key: 'settings', value: { ...current, maxActive: value } })
}

// ---- 初回 ----

/** 初回起動時だけラテアートのロードマップを入れる。削除後に勝手に復活させないよう印を残す */
export async function ensureSeeded() {
  await db.transaction('rw', db.domains, db.skills, db.meta, async () => {
    if (await db.meta.get('seeded')) return
    if ((await db.domains.count()) === 0) {
      for (const t of BUNDLED_TEMPLATES) await addTemplate(t)
    }
    await db.meta.put({ key: 'seeded', value: true })
  })
}

// ---- ロードマップ ----

export async function importTemplate(json: unknown): Promise<string> {
  const t = parseTemplate(json)
  return db.transaction('rw', db.domains, db.skills, () => addTemplate(t))
}

async function addTemplate(t: RoadmapTemplate): Promise<string> {
  const order = (await db.domains.count()) + 1
  const { domain, skills } = templateToEntities(t, { now: Date.now(), order, newId })
  await db.domains.add(domain)
  await db.skills.bulkAdd(skills)
  return domain.id
}

export async function createDomain(name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw new RepoError('分野の名前を入れてください')
  const id = newId()
  await db.domains.add({ id, name: trimmed, order: (await db.domains.count()) + 1, createdAt: Date.now() })
  return id
}

export async function renameDomain(id: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) throw new RepoError('分野の名前を入れてください')
  await db.domains.update(id, { name: trimmed })
}

export async function deleteDomain(id: string) {
  await db.transaction('rw', [db.domains, db.skills, db.records, db.media], async () => {
    const skillIds = (await db.skills.where('domainId').equals(id).toArray()).map((s) => s.id)
    await db.media.where('skillId').anyOf(skillIds).delete()
    await db.records.where('skillId').anyOf(skillIds).delete()
    await db.skills.bulkDelete(skillIds)
    await db.domains.delete(id)
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
  await db.skills.add({ id, domainId, ...clean, status: 'idle', createdAt: Date.now() })
  return id
}

export async function updateSkill(id: string, input: SkillInput) {
  const clean = cleanInput(input)
  await db.transaction('rw', db.skills, async () => {
    const skills = await db.skills.toArray()
    if (clean.prereqIds.includes(id) || wouldCreateCycle(id, clean.prereqIds, skills)) {
      throw new RepoError('前提が循環してしまいます')
    }
    await db.skills.update(id, (s) => void Object.assign(s, clean))
    // 前提を増やしたことで挑戦中のままではいられなくなったものを外す
    const after = await db.skills.toArray()
    for (const s of invalidActives(after)) await db.skills.update(s.id, { status: 'idle', activatedAt: undefined })
  })
}

export async function deleteSkill(id: string) {
  await db.transaction('rw', [db.skills, db.records, db.media], async () => {
    await db.media.where('skillId').equals(id).delete()
    await db.records.where('skillId').equals(id).delete()
    await db.skills.delete(id)
    const dependents = (await db.skills.toArray()).filter((s) => s.prereqIds.includes(id))
    for (const s of dependents) {
      await db.skills.update(s.id, { prereqIds: s.prereqIds.filter((p) => p !== id) })
    }
  })
}

// ---- 挑戦・達成 ----

const ACTIVATE_MESSAGES = {
  locked: '前提のスキルをまだ達成していません',
  done: 'すでに達成しています',
  already: 'すでに挑戦中です',
  limit: '挑戦中の上限に達しています。どれかを達成するか、挑戦をやめてください',
} as const

export async function activateSkill(id: string) {
  await db.transaction('rw', db.skills, db.meta, async () => {
    const skills = await db.skills.toArray()
    const skill = skills.find((s) => s.id === id)
    if (!skill) throw new RepoError('スキルが見つかりません')
    const check = canActivate(skill, skills, (await getSettings()).maxActive)
    if (!check.ok) throw new RepoError(ACTIVATE_MESSAGES[check.reason])
    await db.skills.update(id, { status: 'active', activatedAt: Date.now() })
  })
}

export async function deactivateSkill(id: string) {
  await db.skills.update(id, { status: 'idle', activatedAt: undefined })
}

/** 達成にして、新しく解放されたスキルを返す（解除演出に使う） */
export async function achieveSkill(id: string): Promise<{ skill: Skill; unlocked: Skill[] }> {
  return db.transaction('rw', db.skills, async () => {
    const skills = await db.skills.toArray()
    const skill = skills.find((s) => s.id === id)
    if (!skill) throw new RepoError('スキルが見つかりません')
    if (skill.status === 'done') throw new RepoError('すでに達成しています')
    if (!skill.prereqIds.every((p) => skills.find((s) => s.id === p)?.status === 'done')) {
      throw new RepoError('前提のスキルをまだ達成していません')
    }
    const unlocked = newlyUnlocked(id, skills)
    await db.skills.update(id, { status: 'done', achievedAt: Date.now(), activatedAt: undefined })
    return { skill: { ...skill, status: 'done' as const }, unlocked }
  })
}

export async function revertAchievement(id: string) {
  await db.transaction('rw', db.skills, async () => {
    await db.skills.update(id, { status: 'idle', achievedAt: undefined })
    const after = await db.skills.toArray()
    for (const s of invalidActives(after)) await db.skills.update(s.id, { status: 'idle', activatedAt: undefined })
  })
}

// ---- 記録 ----

export interface RecordInput {
  skillId: string
  outcome?: Outcome
  reason: string
  nextAction: string
  files: Blob[]
}

export async function addRecord(input: RecordInput): Promise<string> {
  const reason = input.reason.trim()
  const nextAction = input.nextAction.trim()
  if (!reason && !nextAction && input.files.length === 0 && !input.outcome) {
    throw new RepoError('動画・写真か、メモを1つ以上入れてください')
  }
  const now = Date.now()
  const recordId = newId()
  const media: Media[] = input.files.map((blob, i) => ({
    id: newId(),
    recordId,
    skillId: input.skillId,
    blob,
    type: blob.type || 'application/octet-stream',
    name: blob instanceof File ? blob.name : undefined,
    size: blob.size,
    createdAt: now + i,
  }))
  const record: PracticeRecord = {
    id: recordId,
    skillId: input.skillId,
    createdAt: now,
    ...(input.outcome ? { outcome: input.outcome } : {}),
    reason,
    nextAction,
    mediaIds: media.map((m) => m.id),
  }
  await db.transaction('rw', db.records, db.media, async () => {
    await db.media.bulkAdd(media)
    await db.records.add(record)
  })
  return recordId
}

export async function deleteRecord(id: string) {
  await db.transaction('rw', db.records, db.media, async () => {
    await db.media.where('recordId').equals(id).delete()
    await db.records.delete(id)
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

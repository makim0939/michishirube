import type { Domain, Reference, Skill } from './types'
import { t } from '../i18n'

/**
 * ロードマップの配布形式。key でスキル同士の前提を表し、取り込むときに id へ置き換える。
 * 他の分野のロードマップもこの形式の JSON にすればアプリから読み込める。
 */
export interface RoadmapTemplate {
  version: 1
  domain: string
  skills: TemplateSkill[]
}

export interface TemplateSkill {
  key: string
  name: string
  description?: string
  /** 練習中に見返す動画や記事 */
  references?: Omit<Reference, 'id'>[]
  /** 前提の key。どれか1つが達成か練習中なら、おすすめに上がる */
  prereqs?: string[]
}

export class TemplateError extends Error {}

/** 出典のリンクは http(s) だけを許す。共有された JSON に javascript: などが入っていても開かないように */
export function isWebUrl(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function webUrl(url: string, field: string): string {
  if (!isWebUrl(url)) throw new TemplateError(t.template.url(field))
  return url
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new TemplateError(t.template.string(field))
  return v
}

export function parseTemplate(input: unknown): RoadmapTemplate {
  if (!isRecord(input)) throw new TemplateError(t.template.notRoadmap)
  if (input.version !== 1) throw new TemplateError(t.template.version)
  const domain = str(input.domain, 'domain')
  if (!Array.isArray(input.skills) || input.skills.length === 0) {
    throw new TemplateError(t.template.noSkills)
  }

  const skills: TemplateSkill[] = input.skills.map((raw, i) => {
    if (!isRecord(raw)) throw new TemplateError(t.template.object(`skills[${i}]`))
    const references = raw.references === undefined ? [] : raw.references
    if (!Array.isArray(references)) throw new TemplateError(t.template.array(`skills[${i}].references`))
    const prereqs = raw.prereqs === undefined ? [] : raw.prereqs
    if (!Array.isArray(prereqs) || prereqs.some((p) => typeof p !== 'string')) {
      throw new TemplateError(t.template.stringArray(`skills[${i}].prereqs`))
    }
    return {
      key: str(raw.key, `skills[${i}].key`),
      name: str(raw.name, `skills[${i}].name`),
      description: typeof raw.description === 'string' ? raw.description : '',
      references: references.map((r, j) => {
        if (!isRecord(r)) throw new TemplateError(t.template.object(`skills[${i}].references[${j}]`))
        const field = `skills[${i}].references[${j}]`
        return {
          title: str(r.title, `${field}.title`),
          url: webUrl(str(r.url, `${field}.url`), `${field}.url`),
          ...(typeof r.note === 'string' && r.note ? { note: r.note } : {}),
        }
      }),
      prereqs: prereqs as string[],
    }
  })

  const keys = new Set<string>()
  for (const s of skills) {
    if (keys.has(s.key)) throw new TemplateError(t.template.duplicate(s.key))
    keys.add(s.key)
  }
  for (const s of skills) {
    for (const p of s.prereqs ?? []) {
      if (!keys.has(p)) throw new TemplateError(t.template.missingPrereq(s.name, p))
    }
  }
  assertAcyclic(skills)
  return { version: 1, domain, skills }
}

function assertAcyclic(skills: TemplateSkill[]) {
  const byKey = new Map(skills.map((s) => [s.key, s]))
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (key: string) => {
    if (state.get(key) === 'done') return
    if (state.get(key) === 'visiting') throw new TemplateError(t.template.cycle(byKey.get(key)!.name))
    state.set(key, 'visiting')
    for (const p of byKey.get(key)!.prereqs ?? []) visit(p)
    state.set(key, 'done')
  }
  for (const s of skills) visit(s.key)
}

export function templateToEntities(
  t: RoadmapTemplate,
  opts: { now: number; order: number; newId: () => string; updatedAt?: number },
): { domain: Domain; skills: Skill[] } {
  const updatedAt = opts.updatedAt ?? opts.now
  const domain: Domain = { id: opts.newId(), name: t.domain, order: opts.order, createdAt: opts.now, updatedAt }
  const idByKey = new Map(t.skills.map((s) => [s.key, opts.newId()]))
  const skills: Skill[] = t.skills.map((s, i) => ({
    id: idByKey.get(s.key)!,
    domainId: domain.id,
    name: s.name,
    description: s.description ?? '',
    references: (s.references ?? []).map((r) => ({ ...r, id: opts.newId() })),
    prereqIds: (s.prereqs ?? []).map((k) => idByKey.get(k)!),
    status: 'idle',
    // 同時刻だと並び順が不定になるので、テンプレートの順序を保つ
    createdAt: opts.now + i,
    updatedAt,
  }))
  return { domain, skills }
}

/** 現在のロードマップをテンプレート形式に書き出す（共有・再利用用） */
export function entitiesToTemplate(domain: Domain, skills: Skill[]): RoadmapTemplate {
  const keyById = new Map(skills.map((s, i) => [s.id, `s${i + 1}`]))
  return {
    version: 1,
    domain: domain.name,
    skills: skills.map((s) => ({
      key: keyById.get(s.id)!,
      name: s.name,
      description: s.description,
      references: s.references.map(({ id: _id, ...r }) => r),
      prereqs: s.prereqIds.map((p) => keyById.get(p)).filter((k): k is string => !!k),
    })),
  }
}

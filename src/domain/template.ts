import type { Domain, Skill, Source } from './types'

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
  criteria: string
  sources?: Source[]
  prereqs?: string[]
}

export class TemplateError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new TemplateError(`${field} は空でない文字列にしてください`)
  return v
}

export function parseTemplate(input: unknown): RoadmapTemplate {
  if (!isRecord(input)) throw new TemplateError('ロードマップの JSON ではありません')
  if (input.version !== 1) throw new TemplateError('version は 1 にしてください')
  const domain = str(input.domain, 'domain')
  if (!Array.isArray(input.skills) || input.skills.length === 0) {
    throw new TemplateError('skills にスキルを1つ以上入れてください')
  }

  const skills: TemplateSkill[] = input.skills.map((raw, i) => {
    if (!isRecord(raw)) throw new TemplateError(`skills[${i}] がオブジェクトではありません`)
    const sources = raw.sources === undefined ? [] : raw.sources
    if (!Array.isArray(sources)) throw new TemplateError(`skills[${i}].sources は配列にしてください`)
    const prereqs = raw.prereqs === undefined ? [] : raw.prereqs
    if (!Array.isArray(prereqs) || prereqs.some((p) => typeof p !== 'string')) {
      throw new TemplateError(`skills[${i}].prereqs は文字列の配列にしてください`)
    }
    return {
      key: str(raw.key, `skills[${i}].key`),
      name: str(raw.name, `skills[${i}].name`),
      description: typeof raw.description === 'string' ? raw.description : '',
      criteria: typeof raw.criteria === 'string' ? raw.criteria : '',
      sources: sources.map((s, j) => {
        if (!isRecord(s)) throw new TemplateError(`skills[${i}].sources[${j}] がオブジェクトではありません`)
        return {
          title: str(s.title, `skills[${i}].sources[${j}].title`),
          ...(typeof s.url === 'string' && s.url ? { url: s.url } : {}),
        }
      }),
      prereqs: prereqs as string[],
    }
  })

  const keys = new Set<string>()
  for (const s of skills) {
    if (keys.has(s.key)) throw new TemplateError(`key「${s.key}」が重複しています`)
    keys.add(s.key)
  }
  for (const s of skills) {
    for (const p of s.prereqs ?? []) {
      if (!keys.has(p)) throw new TemplateError(`「${s.name}」の前提「${p}」が見つかりません`)
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
    if (state.get(key) === 'visiting') throw new TemplateError(`前提が循環しています（${byKey.get(key)!.name}）`)
    state.set(key, 'visiting')
    for (const p of byKey.get(key)!.prereqs ?? []) visit(p)
    state.set(key, 'done')
  }
  for (const s of skills) visit(s.key)
}

export function templateToEntities(
  t: RoadmapTemplate,
  opts: { now: number; order: number; newId: () => string },
): { domain: Domain; skills: Skill[] } {
  const domain: Domain = { id: opts.newId(), name: t.domain, order: opts.order, createdAt: opts.now }
  const idByKey = new Map(t.skills.map((s) => [s.key, opts.newId()]))
  const skills: Skill[] = t.skills.map((s, i) => ({
    id: idByKey.get(s.key)!,
    domainId: domain.id,
    name: s.name,
    description: s.description ?? '',
    criteria: s.criteria,
    sources: s.sources ?? [],
    prereqIds: (s.prereqs ?? []).map((k) => idByKey.get(k)!),
    status: 'idle',
    // 同時刻だと並び順が不定になるので、テンプレートの順序を保つ
    createdAt: opts.now + i,
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
      criteria: s.criteria,
      sources: s.sources,
      prereqs: s.prereqIds.map((p) => keyById.get(p)).filter((k): k is string => !!k),
    })),
  }
}

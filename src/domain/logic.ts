import type { Skill, SkillState } from './types'

/** 前提をすべて達成している。達成にできるのはこのときだけ */
export function prereqsDone(skill: Skill, byId: Map<string, Skill>): boolean {
  return skill.prereqIds.every((id) => byId.get(id)?.status === 'done')
}

/**
 * 前提がすべて「達成」か「挑戦中」。このときは並行して挑戦・記録できる。
 * 例：スチームを練習しながら、同じミルクでドットやハートも練習する
 */
export function prereqsStarted(skill: Skill, byId: Map<string, Skill>): boolean {
  return skill.prereqIds.every((id) => {
    const status = byId.get(id)?.status
    return status === 'done' || status === 'active'
  })
}

export function skillState(skill: Skill, byId: Map<string, Skill>): SkillState {
  if (skill.status === 'done') return 'done'
  if (skill.status === 'active') return 'active'
  return prereqsStarted(skill, byId) ? 'available' : 'locked'
}

export function canAchieve(skill: Skill, byId: Map<string, Skill>): boolean {
  return skill.status !== 'done' && prereqsDone(skill, byId)
}

export function indexById(skills: Skill[]): Map<string, Skill> {
  return new Map(skills.map((s) => [s.id, s]))
}

export function computeStates(skills: Skill[]): Map<string, SkillState> {
  const byId = indexById(skills)
  return new Map(skills.map((s) => [s.id, skillState(s, byId)]))
}

export function countActive(skills: Skill[]): number {
  return skills.filter((s) => s.status === 'active').length
}

export type ActivateCheck =
  | { ok: true }
  | { ok: false; reason: 'locked' | 'done' | 'already' | 'limit' }

/** 挑戦中にできるか。上限は全分野の合計で数える（分散を防ぐため） */
export function canActivate(skill: Skill, skills: Skill[], maxActive: number): ActivateCheck {
  const state = skillState(skill, indexById(skills))
  if (state === 'done') return { ok: false, reason: 'done' }
  if (state === 'active') return { ok: false, reason: 'already' }
  if (state === 'locked') return { ok: false, reason: 'locked' }
  if (countActive(skills) >= maxActive) return { ok: false, reason: 'limit' }
  return { ok: true }
}

/** skillId を達成したことで、達成を目指せるようになったスキル（前提がすべて達成済みになったもの） */
export function newlyUnlocked(skillId: string, skills: Skill[]): Skill[] {
  const after = skills.map((s) => (s.id === skillId ? { ...s, status: 'done' as const } : s))
  const byId = indexById(after)
  return after.filter(
    (s) => s.status !== 'done' && s.prereqIds.includes(skillId) && prereqsDone(s, byId),
  )
}

/** skillId の前提を prereqIds にしたとき循環するか */
export function wouldCreateCycle(skillId: string, prereqIds: string[], skills: Skill[]): boolean {
  const graph = new Map(skills.map((s) => [s.id, s.prereqIds]))
  graph.set(skillId, prereqIds)
  // skillId から前提をたどって skillId に戻れたら循環
  const stack = [...prereqIds]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const id = stack.pop()!
    if (id === skillId) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(graph.get(id) ?? []))
  }
  return false
}

/** skillId より後ろ（skillId を直接・間接に前提とする）スキル。前提の候補から除外するのに使う */
export function descendants(skillId: string, skills: Skill[]): Set<string> {
  const result = new Set<string>()
  let frontier = [skillId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const s of skills) {
      if (!result.has(s.id) && s.prereqIds.some((p) => frontier.includes(p))) {
        result.add(s.id)
        next.push(s.id)
      }
    }
    frontier = next
  }
  return result
}

/** 前提の深さ（最長経路）。並び順に使う */
export function depths(skills: Skill[]): Map<string, number> {
  const byId = indexById(skills)
  const memo = new Map<string, number>()
  const visit = (s: Skill, path: Set<string>): number => {
    const cached = memo.get(s.id)
    if (cached !== undefined) return cached
    if (path.has(s.id)) return 0
    path.add(s.id)
    let d = 0
    for (const p of s.prereqIds) {
      const ps = byId.get(p)
      if (ps) d = Math.max(d, visit(ps, path) + 1)
    }
    path.delete(s.id)
    memo.set(s.id, d)
    return d
  }
  for (const s of skills) visit(s, new Set())
  return memo
}

export function sortByDepth(skills: Skill[]): Skill[] {
  const d = depths(skills)
  return [...skills].sort((a, b) => d.get(a.id)! - d.get(b.id)! || a.createdAt - b.createdAt)
}

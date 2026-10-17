import type { Skill, SkillState } from './types'

/**
 * 前提は、複数あっても「どれか1つ」でよい（ラテアートは、スワンのように、道がいくつもあるため）。
 * 前提が無い型は、最初から満たしている（some は空だと偽になるので分ける）
 */
export function prereqsDone(skill: Skill, byId: Map<string, Skill>): boolean {
  return skill.prereqIds.length === 0 || skill.prereqIds.some((id) => byId.get(id)?.status === 'done')
}

/**
 * 練習中とみなす日数。この日数のあいだに記録した型を「練習中」にする（自分で出し入れしない）
 */
export const PRACTICING_DAYS = 21

/**
 * 前提のどれか1つが「達成」か「練習中」。このときは並行して練習できる。
 * 例：スチームを練習しながら、同じミルクでドットやハートも練習する
 */
function prereqsStarted(skill: Skill, byId: Map<string, Skill>, practicing: ReadonlySet<string>): boolean {
  return (
    skill.prereqIds.length === 0 ||
    skill.prereqIds.some((id) => byId.get(id)?.status === 'done' || practicing.has(id))
  )
}

/** practicing は、最近記録した型（練習中）の id */
function skillState(skill: Skill, byId: Map<string, Skill>, practicing: ReadonlySet<string>): SkillState {
  if (skill.status === 'done') return 'done'
  if (practicing.has(skill.id)) return 'active'
  return prereqsStarted(skill, byId, practicing) ? 'available' : 'locked'
}

export function canAchieve(skill: Skill, byId: Map<string, Skill>): boolean {
  return skill.status !== 'done' && prereqsDone(skill, byId)
}

export function indexById(skills: Skill[]): Map<string, Skill> {
  return new Map(skills.map((s) => [s.id, s]))
}

export function computeStates(skills: Skill[], practicing: ReadonlySet<string>): Map<string, SkillState> {
  const byId = indexById(skills)
  return new Map(skills.map((s) => [s.id, skillState(s, byId, practicing)]))
}

/**
 * 練習中の型：最近（PRACTICING_DAYS 日以内）に記録した型。
 * 1つも無ければ、最後に記録した型（久しぶりに開いても、続きからすぐ記録できるように）
 */
export function practicingFrom(recent: { skillId: string }[], last: { skillId: string } | undefined): Set<string> {
  const ids = new Set(recent.map((r) => r.skillId))
  if (ids.size === 0 && last) ids.add(last.skillId)
  return ids
}

/**
 * skillId を達成したことで、はじめて前提を満たしたスキル。
 * 前提はどれか1つでよいので、別の前提を先に達成していた型は、もう満たしていた（もう一度は出さない）
 */
export function newlyUnlocked(skillId: string, skills: Skill[]): Skill[] {
  const before = indexById(skills)
  const after = skills.map((s) => (s.id === skillId ? { ...s, status: 'done' as const } : s))
  const byId = indexById(after)
  return after.filter(
    (s) =>
      s.status !== 'done' &&
      s.prereqIds.includes(skillId) &&
      prereqsDone(s, byId) &&
      !prereqsDone(s, before),
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

/** 前提の深さ（どれか1つでよいので、いちばん短い経路）。並び順に使う */
function depths(skills: Skill[]): Map<string, number> {
  const byId = indexById(skills)
  const memo = new Map<string, number>()
  const visit = (s: Skill, path: Set<string>): number => {
    const cached = memo.get(s.id)
    if (cached !== undefined) return cached
    if (path.has(s.id)) return 0
    path.add(s.id)
    const found = s.prereqIds.map((p) => byId.get(p)).filter((p): p is Skill => !!p)
    const d = found.length === 0 ? 0 : Math.min(...found.map((p) => visit(p, path) + 1))
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

/**
 * 練習中の型の並び。最近練習した型を上に（撮るときに、カードを探さずに済むように）。
 * 今日の画面と型の画面で同じ並びにする
 */
export function practiceOrder<T>(items: T[], lastOf: (item: T) => number): T[] {
  return items.slice().sort((a, b) => lastOf(b) - lastOf(a))
}

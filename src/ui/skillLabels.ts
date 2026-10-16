import type { Skill } from '../domain/types'
import { splitName } from './common'

/**
 * 型の一覧で、名前の下に添える一言。前提は「おすすめの順」なので、決まりではなく順番のめやすとして書く
 */

function names(list: Skill[]): string {
  return list.map((s) => `「${splitName(s.name).main}」`).join('')
}

function prereqsOf(skill: Skill, byId: Map<string, Skill>): Skill[] {
  return skill.prereqIds.map((id) => byId.get(id)).filter((p): p is Skill => !!p)
}

/** 次のおすすめ（前提ができている・練習中の型）に添える一言。practicing は練習中（最近記録した）型の id、recorded は記録のある型の id */
export function recommendLabel(
  skill: Skill,
  byId: Map<string, Skill>,
  practicingIds: ReadonlySet<string>,
  recorded: ReadonlySet<string>,
): string {
  const prereqs = prereqsOf(skill, byId)
  if (prereqs.length === 0) return '最初の型'
  const practicing = prereqs.filter((p) => p.status !== 'done' && practicingIds.has(p.id))
  // 前提を練習している途中でも始められる。前提の名前を出さず、この型の記録の有無だけを伝える
  if (practicing.length > 0) return recorded.has(skill.id) ? '最近の記録はありません' : 'まだ記録がありません'
  return `${names(prereqs)}のつぎ`
}

/** その先の型（前提がまだ）に添える一言 */
export function laterLabel(skill: Skill, byId: Map<string, Skill>): string {
  const pending = prereqsOf(skill, byId).filter((p) => p.status !== 'done')
  return pending.length > 0 ? `${names(pending)}のあとがおすすめ` : ''
}

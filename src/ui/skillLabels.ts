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

/** 次のおすすめ（前提ができている・練習中の型）に添える一言 */
export function recommendLabel(skill: Skill, byId: Map<string, Skill>): string {
  const prereqs = prereqsOf(skill, byId)
  if (prereqs.length === 0) return '最初の型'
  const practicing = prereqs.filter((p) => p.status === 'active')
  // 前提を練習している途中なら、並行して練習できる
  if (practicing.length > 0) return `${names(practicing)}と並行して`
  return `${names(prereqs)}のつぎ`
}

/** その先の型（前提がまだ）に添える一言 */
export function laterLabel(skill: Skill, byId: Map<string, Skill>): string {
  const pending = prereqsOf(skill, byId).filter((p) => p.status !== 'done')
  return pending.length > 0 ? `${names(pending)}のあとがおすすめ` : ''
}

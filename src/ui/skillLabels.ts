import type { Skill } from '../domain/types'
import { splitName } from './common'
import { t } from '../i18n'

/**
 * 型の一覧で、名前の下に添える一言。次のおすすめは記録の有無だけ、その先の型は前提を「おすすめの順」のめやすとして書く（決まりではない）
 */

function prereqsOf(skill: Skill, byId: Map<string, Skill>): Skill[] {
  return skill.prereqIds.map((id) => byId.get(id)).filter((p): p is Skill => !!p)
}

/**
 * 次のおすすめ（前提ができている・練習中の型）に添える一言。recorded は記録のある型の id。
 * 順番の説明（「最初の型」「〇〇のつぎ」）は出さず、この型の記録の有無だけを、どの型にも同じ言い方で伝える
 */
export function recommendLabel(skill: Skill, recorded: ReadonlySet<string>): string {
  return recorded.has(skill.id) ? t.skillLabels.noRecent : t.common.noRecordsYet
}

/** その先の型（前提がまだ）に添える一言。前提のどれかが達成済みなら、もう先ではないので何も添えない */
export function laterLabel(skill: Skill, byId: Map<string, Skill>): string {
  const prereqs = prereqsOf(skill, byId)
  if (prereqs.length === 0 || prereqs.some((p) => p.status === 'done')) return ''
  return t.skillLabels.after(prereqs.map((p) => splitName(p.name).main))
}

import { summarizeTips } from '../domain/tips'
import type { PracticeRecord, Skill, SkillState } from '../domain/types'
import { formatAgo, splitName, STATE_LABEL } from './common'
import { ForwardIcon } from './icons'
import { References } from './References'
import { href } from './router'
import { t } from '../i18n'

/**
 * 自分のコツ。一般的な描き方の文章ではなく、自分の記録から「注ぐ前に読み返したいこと」をまとめる。
 * 記録するほど中身が増える（いま意識していること・つまずきやすいところ・うまくいったときのメモ）。
 * 手本の動画・記事も、ここに置く
 */
export function SkillTips({
  skill,
  records,
  numbers,
}: {
  skill: Skill
  /** 新しい順 */
  records: PracticeRecord[]
  numbers?: Map<string, number>
}) {
  const tips = summarizeTips(records)
  const empty = !tips.focus && tips.stumbles.length === 0 && tips.wins.length === 0

  return (
    <section className="section">
      {/* 中身が無いあいだは、見出しも説明も出さない（記録するとここに現れる。空の枠と説明文を先に見せない） */}
      {!empty && <h2>{t.skill.tips}</h2>}
      {!empty && (
        <div className="tips-card">
          {tips.focus && (
            <div className="tip-block">
              <span className="tip-label">{t.skill.focus(formatAgo(tips.focus.at))}</span>
              <p className="tip-focus">{tips.focus.text}</p>
            </div>
          )}
          {tips.stumbles.length > 0 && (
            <div className="tip-block">
              <span className="tip-label">{t.skill.stumbles(tips.window)}</span>
              <ul className="stumbles">
                {tips.stumbles.map((s) => (
                  <li key={s.cause}>
                    {s.cause}
                    <span className="stumble-count">{t.skill.times(s.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tips.wins.length > 0 && (
            <div className="tip-block">
              <span className="tip-label">{t.skill.wins}</span>
              <ul className="wins">
                {tips.wins.map((w) => (
                  <li key={w.recordId}>
                    <a href={href(`/cup/${w.recordId}`)}>
                      {numbers?.has(w.recordId) && <span className="win-no">No.{numbers.get(w.recordId)}</span>}
                      <span className="win-text">{w.text}</span>
                      <ForwardIcon size={14} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <References skill={skill} />
    </section>
  )
}

/** この型について（自分で書いた説明・前後の型）。読むことは少ないので、閉じておく */
export function AboutSkill({
  skill,
  prereqs,
  leadsTo,
  states,
}: {
  skill: Skill
  prereqs: Skill[]
  leadsTo: Skill[]
  states: Map<string, SkillState>
}) {
  const link = (s: Skill) => (
    <li key={s.id}>
      <a href={href(`/skill/${s.id}`)}>
        {splitName(s.name).main}
        <span className="chip-state">{STATE_LABEL[states.get(s.id)!]}</span>
      </a>
    </li>
  )
  if (!skill.description && prereqs.length === 0 && leadsTo.length === 0) return null
  return (
    <details className="section about-skill">
      <summary>{t.skill.about}</summary>
      {skill.description && <p className="prewrap">{skill.description}</p>}
      {prereqs.length > 0 && (
        <>
          <h3>{t.skill.prereqs}</h3>
          <ul className="chips">{prereqs.map(link)}</ul>
        </>
      )}
      {leadsTo.length > 0 && (
        <>
          <h3>{t.skill.leadsTo}</h3>
          <ul className="chips">{leadsTo.map(link)}</ul>
        </>
      )}
    </details>
  )
}

import { isWebUrl } from '../domain/template'
import { summarizeTips } from '../domain/tips'
import type { PracticeRecord, Skill, SkillState } from '../domain/types'
import { formatAgo, splitName, STATE_LABEL } from './common'
import { ForwardIcon } from './icons'
import { References } from './References'
import { href } from './router'

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
      <h2>自分のコツ</h2>
      {empty ? (
        <p className="muted small">記録で書いた次の一手や、選んだ原因が、ここにたまります。</p>
      ) : (
        <div className="tips-card">
          {tips.focus && (
            <div className="tip-block">
              <span className="tip-label">いま意識していること（{formatAgo(tips.focus.at)}）</span>
              <p className="tip-focus">{tips.focus.text}</p>
            </div>
          )}
          {tips.stumbles.length > 0 && (
            <div className="tip-block">
              <span className="tip-label">つまずきやすいところ（直近{tips.window}杯）</span>
              <ul className="stumbles">
                {tips.stumbles.map((s) => (
                  <li key={s.cause}>
                    {s.cause}
                    <span className="stumble-count">{s.count}回</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tips.wins.length > 0 && (
            <div className="tip-block">
              <span className="tip-label">うまくいったときのメモ</span>
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

/** この型について（一般的な説明・参考の目安・前後の型・出典）。読むことは少ないので、閉じておく */
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
  if (!skill.description && !skill.criteria && prereqs.length === 0 && leadsTo.length === 0 && skill.sources.length === 0) {
    return null
  }
  return (
    <details className="section about-skill">
      <summary>この型について</summary>
      {skill.description && <p className="prewrap">{skill.description}</p>}
      {skill.criteria && (
        <p className="prewrap">
          <strong>参考の目安</strong>
          {skill.criteria}
        </p>
      )}
      {prereqs.length > 0 && (
        <>
          <h3>先にやると進めやすい型</h3>
          <ul className="chips">{prereqs.map(link)}</ul>
        </>
      )}
      {leadsTo.length > 0 && (
        <>
          <h3>次のステップ</h3>
          <ul className="chips">{leadsTo.map(link)}</ul>
        </>
      )}
      {skill.sources.length > 0 && (
        <>
          <h3>出典</h3>
          <ul className="sources">
            {skill.sources.map((s, i) => (
              <li key={i}>
                {s.url && isWebUrl(s.url) ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  )
}

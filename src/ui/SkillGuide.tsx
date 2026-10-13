import { useEffect, useRef } from 'react'
import { parseGuide } from '../domain/guide'
import { isWebUrl } from '../domain/template'
import type { Skill, SkillState } from '../domain/types'
import { splitName, STATE_LABEL } from './common'
import { BulbIcon, ForwardIcon } from './icons'
import { References } from './References'
import { href } from './router'

/**
 * 描き方ガイド。型の画面からシートで開き、やり方・コツ・参考資料・前後の型をまとめて見る
 * （型の画面には、練習の記録と見比べだけを残す）
 */
export function SkillGuide({
  skill,
  prereqs,
  leadsTo,
  states,
  onClose,
}: {
  skill: Skill
  prereqs: Skill[]
  leadsTo: Skill[]
  states: Map<string, SkillState>
  onClose: () => void
}) {
  const guide = parseGuide(skill.description)

  const done = useRef<HTMLButtonElement>(null)
  const latestClose = useRef(onClose)
  latestClose.current = onClose

  // 開いている間は、後ろの画面をスクロールさせない。選んでいる場所はシートに移し、閉じたら元に戻す。
  // Esc でも閉じる（PC のキーボード）
  useEffect(() => {
    const previous = document.body.style.overflow
    const opener = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    done.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latestClose.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  const chip = (s: Skill) => (
    <li key={s.id}>
      <a href={href(`/skill/${s.id}`)} className="guide-link" onClick={onClose}>
        <span className="guide-link-name">{splitName(s.name).main}</span>
        <span className="chip-state">{STATE_LABEL[states.get(s.id)!]}</span>
        <ForwardIcon size={16} />
      </a>
    </li>
  )

  return (
    <div className="guide-sheet" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <header className="guide-head">
        <h1 id="guide-title">{splitName(skill.name).main}</h1>
        <button ref={done} type="button" className="btn small" onClick={onClose}>
          完了
        </button>
      </header>

      <div className="guide-body">
        {guide.body.length > 0 && (
          <section className="guide-card">
            <h2>やり方</h2>
            {guide.body.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </section>
        )}

        {(guide.tips.length > 0 || skill.criteria) && (
          <section>
            <h2 className="guide-label">コツと目安</h2>
            <ul className="guide-card guide-tips">
              {guide.tips.map((tip, i) => (
                <li key={i}>
                  <BulbIcon size={18} />
                  <span>
                    {tip.label && <strong>{tip.label}</strong>}
                    {tip.text}
                  </span>
                </li>
              ))}
              {skill.criteria && (
                <li>
                  <BulbIcon size={18} />
                  <span>
                    <strong>参考の目安</strong>
                    {skill.criteria}
                  </span>
                </li>
              )}
            </ul>
          </section>
        )}

        <References skill={skill} />

        {prereqs.length > 0 && (
          <section>
            <h2 className="guide-label">先にやると進めやすい型</h2>
            <ul className="guide-card guide-links">{prereqs.map(chip)}</ul>
          </section>
        )}

        {leadsTo.length > 0 && (
          <section>
            <h2 className="guide-label">次のステップ</h2>
            <ul className="guide-card guide-links">{leadsTo.map(chip)}</ul>
          </section>
        )}

        {skill.sources.length > 0 && (
          <section>
            <h2 className="guide-label">出典</h2>
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
          </section>
        )}
      </div>
    </div>
  )
}

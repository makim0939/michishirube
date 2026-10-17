import { useEffect, useRef } from 'react'
import type { Skill } from '../domain/types'
import { splitName } from './common'
import { CheckIcon } from './icons'
import { PatternImage } from './PatternImage'

/**
 * 記録の型を選び直すシート（画面の下から出す）。
 * 見本の絵と名前を並べ、いまの型に印を付ける。選んだら閉じる
 */
export function SkillPicker({
  skills,
  current,
  onPick,
  onClose,
}: {
  skills: Skill[]
  current: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  const latestClose = useRef(onClose)
  latestClose.current = onClose
  // Esc でも閉じる（PC のキーボード）。閉じたら、押した見出しにキーボードの位置を戻す
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latestClose.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div
        className="picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="型を選ぶ"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-head">
          <h2>型を選ぶ</h2>
          <button type="button" className="btn small" autoFocus onClick={onClose}>
            閉じる
          </button>
        </div>
        <ul className="skill-pick-list">
          {skills.map((s) => {
            const { main, sub } = splitName(s.name)
            const selected = s.id === current
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={selected ? 'skill-pick selected' : 'skill-pick'}
                  aria-pressed={selected}
                  onClick={() => onPick(s.id)}
                >
                  <PatternImage name={s.name} className="small" />
                  <span className="skill-pick-name">
                    {main}
                    {sub && <small className="muted">{sub}</small>}
                  </span>
                  {selected && <CheckIcon size={18} />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

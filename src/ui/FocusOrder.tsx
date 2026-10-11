import { useRef, useState, type PointerEvent } from 'react'
import { setFocusOrder } from '../data/repo'
import { moveItem } from '../domain/logic'
import type { Skill } from '../domain/types'
import { splitName } from './common'
import { useAction } from './feedback'
import { ChevronDownIcon, ChevronUpIcon, GripIcon } from './icons'
import { PatternImage } from './PatternImage'

/**
 * 練習中の型の並べ替え。つまみをドラッグするか、上下のボタンで動かす（ドラッグしにくいとき・読み上げのとき用）。
 * いま集中している型を上に置けるようにする
 */
export function FocusOrder({ skills, onDone }: { skills: Skill[]; onDone: () => void }) {
  const run = useAction()
  const [ids, setIds] = useState(() => skills.map((s) => s.id))
  const [dragging, setDragging] = useState<string | null>(null)
  const latest = useRef(ids)
  latest.current = ids
  const rows = useRef(new Map<string, HTMLLIElement>())
  const byId = new Map(skills.map((s) => [s.id, s]))
  // 並べ替えの途中で練習をやめた型は外し、始めた型は後ろに足す
  const shown = [...ids.filter((id) => byId.has(id)), ...skills.map((s) => s.id).filter((id) => !ids.includes(id))]

  const save = (next: string[]) => {
    setIds(next)
    void run(() => setFocusOrder(next))
  }

  const onMove = (e: PointerEvent) => {
    if (!dragging) return
    const others = latest.current.filter((id) => id !== dragging)
    // 指の位置より下に中心がある最初の行の前に入れる
    let to = others.findIndex((id) => {
      const rect = rows.current.get(id)?.getBoundingClientRect()
      return rect ? e.clientY < rect.top + rect.height / 2 : false
    })
    if (to < 0) to = others.length
    const next = [...others.slice(0, to), dragging, ...others.slice(to)]
    if (next.join() !== latest.current.join()) setIds(next)
  }

  const endDrag = () => {
    if (!dragging) return
    setDragging(null)
    save(latest.current)
  }

  return (
    <div className="focus-order">
      <p className="muted small">つまみ（≡）をドラッグするか、矢印で並べ替えます。上にあるほど、今日の画面で上に出ます。</p>
      <ol className="focus-order-list">
        {shown.map((id, i) => {
          const skill = byId.get(id)!
          const name = splitName(skill.name).main
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) rows.current.set(id, el)
                else rows.current.delete(id)
              }}
              className={dragging === id ? 'dragging' : ''}
            >
              <span
                className="focus-order-handle"
                role="presentation"
                onPointerDown={(e) => {
                  try {
                    // 指が行の外に出ても、離すまでこのつまみで追う
                    e.currentTarget.setPointerCapture(e.pointerId)
                  } catch {
                    // 取れなくても、行の上で動かす分には並べ替えられる
                  }
                  setDragging(id)
                }}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <GripIcon size={22} />
              </span>
              <PatternImage name={skill.name} className="tiny" />
              <span className="focus-order-name">{name}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`「${name}」を上へ`}
                disabled={i === 0}
                onClick={() => save(moveItem(shown, i, i - 1))}
              >
                <ChevronUpIcon size={20} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`「${name}」を下へ`}
                disabled={i === shown.length - 1}
                onClick={() => save(moveItem(shown, i, i + 1))}
              >
                <ChevronDownIcon size={20} />
              </button>
            </li>
          )
        })}
      </ol>
      <button type="button" className="btn primary" onClick={onDone}>
        完了
      </button>
    </div>
  )
}

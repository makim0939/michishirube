import { patternFor, patternUrl } from './world'

/** 型の見本の絵。見本の無い型（自分で作った分野など）は、クレマの丸 */
export function PatternImage({ name, className, dim }: { name: string; className?: string; dim?: boolean }) {
  const p = patternFor(name)
  const cls = `pattern-image ${className ?? ''} ${dim ? 'dim' : ''}`
  return p ? <img className={cls} src={patternUrl(p)} alt="" /> : <span className={`${cls} none`} aria-hidden="true" />
}

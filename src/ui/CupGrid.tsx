import { OUTCOME_MARK } from '../domain/format'
import type { Media, PracticeRecord } from '../domain/types'
import { useObjectUrl } from './common'
import { useCupImage } from './cupImage'
import { PatternImage } from './PatternImage'
import { href } from './router'

export interface Cup {
  record: PracticeRecord
  /** カップの絵として見せる動画・写真（無ければ型の見本の絵） */
  media?: Media
  /** 杯の通し番号（No.） */
  number: number
  /** 型の名前（絵が無いときの見本の絵と、読み上げに使う） */
  skillName?: string
}

/** 1杯。押すと、その1杯の詳細（動画・写真と理由）を開く */
export function CupTile({ cup }: { cup: Cup }) {
  const blob = useCupImage(cup.media)
  const url = useObjectUrl(blob, cup.media ? `${cup.media.id}-tile-${blob?.size ?? 0}` : undefined)
  const mark = cup.record.outcome ? ` ${OUTCOME_MARK[cup.record.outcome]}` : ''
  return (
    <li>
      <a
        className="cup-tile"
        href={href(`/cup/${cup.record.id}`)}
        aria-label={`No.${cup.number}${cup.skillName ? ` ${cup.skillName}` : ''}の詳細`}
      >
        {url ? (
          <img src={url} alt="" />
        ) : (
          <span className="cup-tile-empty" aria-hidden="true">
            {cup.skillName && <PatternImage name={cup.skillName} dim />}
          </span>
        )}
        <span className="cup-tile-no">
          No.{cup.number}
          {mark}
        </span>
      </a>
    </li>
  )
}

/** 杯を写真の格子で並べる（カップ帳・型の記録） */
export function CupGrid({ cups }: { cups: Cup[] }) {
  return (
    <ul className="cup-grid">
      {cups.map((c) => (
        <CupTile key={c.record.id} cup={c} />
      ))}
    </ul>
  )
}

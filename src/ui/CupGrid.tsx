import { OUTCOME_MARK } from '../domain/format'
import type { Media, PracticeRecord } from '../domain/types'
import { splitName } from './common'
import { useCupImageUrl } from './cupImage'
import { AlertIcon } from './icons'
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
  /** YouTube へのアップに失敗した動画がある（1杯の詳細で上げ直せる） */
  failed?: boolean
}

/** 1杯。押すと、その1杯の詳細（動画・写真と理由）を開く */
function CupTile({ cup }: { cup: Cup }) {
  // 一覧では、前の作り方のサムネイルは作り直さない（見ただけで、たくさんの動画を読み込まないように）
  const url = useCupImageUrl(cup.media, 'tile', { upgrade: false })
  const mark = cup.record.outcome ? ` ${OUTCOME_MARK[cup.record.outcome]}` : ''
  return (
    <li>
      <a
        className="cup-tile"
        href={href(`/cup/${cup.record.id}`)}
        aria-label={`No.${cup.number}${cup.skillName ? ` ${splitName(cup.skillName).main}` : ''}${cup.failed ? '（アップに失敗）' : ''}の詳細`}
      >
        {url ? (
          <img src={url} alt="" />
        ) : (
          <span className="cup-tile-empty" aria-hidden="true">
            {cup.skillName && <PatternImage name={cup.skillName} dim />}
          </span>
        )}
        {cup.failed && (
          <span className="cup-tile-alert" aria-hidden="true">
            <AlertIcon size={14} />
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

/** 杯を写真の格子で並べる（ラテ帳・型の記録） */
export function CupGrid({ cups }: { cups: Cup[] }) {
  return (
    <ul className="cup-grid">
      {cups.map((c) => (
        <CupTile key={c.record.id} cup={c} />
      ))}
    </ul>
  )
}

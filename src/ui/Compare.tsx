import { useRef, useState } from 'react'
import { daysBetween, spanLabel } from '../domain/format'
import type { Media } from '../domain/types'
import { isVideo, type PlayerControl } from './common'
import { useCupImageUrl } from './cupImage'
import { MediaItem } from './MediaItem'
import { PlayIcon } from './icons'

type Kind = 'video' | 'image'
type Slot = 0 | 1
const SLOT_NAME = ['左', '右'] as const

/**
 * 2杯を並べて、上達を目で見られるようにする。はじめは最新と最初（今日の画面と同じく、新しいほうを左に）。
 * 「選び直す」で、左 → 右の順に1杯ずつ選び直せる（いま選んでいる側の枠を光らせる）
 */
export function Compare({ media, numberOf }: { media: Media[]; numberOf: (m: Media) => number | undefined }) {
  const videos = media.filter(isVideo)
  const images = media.filter((m) => !isVideo(m))
  // 2つ以上あって比べられる種類だけを選べるようにする
  const kinds: Kind[] = [...(videos.length >= 2 ? (['video'] as const) : []), ...(images.length >= 2 ? (['image'] as const) : [])]
  const [picked, setPicked] = useState<Kind>()
  /** 選び直した2杯（左・右の順）。無ければ最新と最初 */
  const [chosen, setChosen] = useState<[string, string]>()
  /** 選び直している側。選び直していなければ undefined */
  const [editing, setEditing] = useState<Slot>()
  /** 選び直す前の2杯（やめたときに戻す） */
  const before = useRef<[string, string] | undefined>(undefined)
  const players = useRef<(PlayerControl | null)[]>([])
  const kind = picked && kinds.includes(picked) ? picked : kinds[0]
  if (!kind) return null

  const list = kind === 'video' ? videos : images
  const byId = new Map(list.map((m) => [m.id, m]))
  const fallback: [Media, Media] = [list[list.length - 1], list[0]]
  const chosenPair = chosen?.map((id) => byId.get(id))
  const custom = !!chosenPair && chosenPair.every((m) => !!m)
  const pair: [Media, Media] = custom ? (chosenPair as [Media, Media]) : fallback
  const label = (m: Media, i: Slot) => {
    if (!custom) return i === 0 ? '最新' : '最初'
    const n = numberOf(m)
    return n ? `No.${n}` : ''
  }
  const span = spanLabel(daysBetween(pair[0].createdAt, pair[1].createdAt))

  const switchKind = (k: Kind) => {
    setPicked(k)
    setChosen(undefined)
    setEditing(undefined)
  }
  const startEditing = () => {
    before.current = chosen
    setEditing(0)
  }
  const cancelEditing = () => {
    setChosen(before.current)
    setEditing(undefined)
  }
  const pick = (id: string) => {
    if (editing === undefined) return
    const next: [string, string] = [pair[0].id, pair[1].id]
    const other = editing === 0 ? 1 : 0
    // 反対側に並んでいる杯を選んだら、左右を入れ替える（同じ杯を2つ並べない）
    if (next[other] === id) next[other] = next[editing]
    next[editing] = id
    setChosen(next)
    // 左を選んだら、続けて右を選ぶ
    setEditing(editing === 0 ? 1 : undefined)
  }

  return (
    <section className="section">
      <div className="section-head">
        <div className="compare-title">
          <h2>{custom ? '選んだ2杯' : '最新と最初'}</h2>
          {custom && editing === undefined && (
            <button type="button" className="quiet-button" onClick={() => setChosen(undefined)}>
              最新と最初に戻す
            </button>
          )}
        </div>
        {kinds.length > 1 && (
          <div className="segmented small">
            <button className={kind === 'video' ? 'selected' : ''} onClick={() => switchKind('video')}>
              動画
            </button>
            <button className={kind === 'image' ? 'selected' : ''} onClick={() => switchKind('image')}>
              写真
            </button>
          </div>
        )}
      </div>
      <div className="compare">
        {pair.map((m, i) => (
          <div key={`${i}-${m.id}`} className={editing === i ? 'compare-slot editing' : 'compare-slot'}>
            <MediaItem
              media={m}
              autoLoad
              bare
              playerRef={(p) => {
                players.current[i] = p
              }}
            />
            <p className="compare-label">{label(m, i as Slot)}</p>
          </div>
        ))}
        {/* 2杯の間に、何日たったかを渡す */}
        <span className="compare-span">{span}</span>
      </div>

      {editing === undefined ? (
        <div className="compare-actions">
          {kind === 'video' && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                for (const p of players.current) p?.playMutedFromStart()
              }}
            >
              <PlayIcon size={16} />
              同時に再生
            </button>
          )}
          <button type="button" className="btn small" onClick={startEditing}>
            選び直す
          </button>
        </div>
      ) : (
        <div className="cup-picker">
          <div className="cup-picker-head">
            <p>
              <strong>{SLOT_NAME[editing]}</strong>に並べる杯を選んでください
            </p>
            <button type="button" className="quiet-button" onClick={cancelEditing}>
              やめる
            </button>
          </div>
          <ul>
            {/* 新しい順に並べる（見比べの左が新しいほう） */}
            {[...list].reverse().map((m) => (
              <PickerItem
                key={m.id}
                media={m}
                number={numberOf(m)}
                slot={m.id === pair[0].id ? 0 : m.id === pair[1].id ? 1 : undefined}
                onPick={() => pick(m.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function PickerItem({
  media,
  number,
  slot,
  onPick,
}: {
  media: Media
  number?: number
  /** いま左・右に並んでいる杯なら、その側 */
  slot?: Slot
  onPick: () => void
}) {
  const url = useCupImageUrl(media, 'pick', { upgrade: false })
  return (
    <li>
      <button
        type="button"
        className={slot === undefined ? 'cup-pick' : 'cup-pick selected'}
        aria-label={`${number ? `No.${number}` : '杯'}${slot === undefined ? '' : `（いま${SLOT_NAME[slot]}）`}`}
        onClick={onPick}
      >
        {url ? <img src={url} alt="" /> : <span className="cup-pick-empty" />}
        {!!number && <span className="cup-pick-date">No.{number}</span>}
        {slot !== undefined && (
          <span className="cup-pick-check" aria-hidden="true">
            {SLOT_NAME[slot]}
          </span>
        )}
      </button>
    </li>
  )
}

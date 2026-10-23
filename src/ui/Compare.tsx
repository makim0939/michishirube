import { useEffect, useRef, useState } from 'react'
import { daysBetween, spanLabel } from '../domain/format'
import type { Media } from '../domain/types'
import { isVideo, type PlayerControl } from './common'
import { useCupImageUrl } from './cupImage'
import { MediaItem } from './MediaItem'
import { useBackHandler } from './useBackHandler'
import { CheckIcon, ChevronDownIcon, PlayIcon } from './icons'

type Kind = 'video' | 'image'
type Slot = 0 | 1

/**
 * 2杯を並べて、上達を目で見られるようにする。はじめは最新と最初（今日の画面と同じく、新しいほうを左に）。
 * 比較写真のアプリと同じく、入れ替えたい側の下（「最新 ▾」など）を押すと、その側に並べる杯を選べる
 */
export function Compare({
  media,
  numberOf,
  dateOf = (m) => m.createdAt,
}: {
  /** 杯の日時の古い順 */
  media: Media[]
  numberOf: (m: Media) => number | undefined
  /** その動画・写真の杯の日時（間の日数に使う。入れた時刻は、あとから編集で足すと杯の日時とずれる） */
  dateOf?: (m: Media) => number
}) {
  const videos = media.filter(isVideo)
  const images = media.filter((m) => !isVideo(m))
  // 2つ以上あって比べられる種類だけを選べるようにする。はじめは写真（左）。動画は、軽く見たいときだけ読み込まれないよう、切り替えたときに出す
  const kinds: Kind[] = [...(images.length >= 2 ? (['image'] as const) : []), ...(videos.length >= 2 ? (['video'] as const) : [])]
  const [picked, setPicked] = useState<Kind>()
  /** 選び直した2杯（左・右の順）。無ければ最新と最初 */
  const [chosen, setChosen] = useState<[string, string]>()
  /** 入れ替える杯を選んでいる側。選んでいなければ undefined */
  const [editing, setEditing] = useState<Slot>()
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
  const span = spanLabel(daysBetween(dateOf(pair[0]), dateOf(pair[1])))

  const switchKind = (k: Kind) => {
    setPicked(k)
    setChosen(undefined)
    setEditing(undefined)
  }
  const pick = (id: string) => {
    if (editing === undefined) return
    const next: [string, string] = [pair[0].id, pair[1].id]
    next[editing] = id
    setChosen(next)
    setEditing(undefined)
  }

  return (
    <section className="section">
      <div className="section-head">
        <div className="compare-title">
          <h2>{custom ? '選んだ2杯' : '最新と最初'}</h2>
          {custom && (
            <button type="button" className="quiet-button" onClick={() => setChosen(undefined)}>
              最新と最初に戻す
            </button>
          )}
        </div>
        {kinds.length > 1 && (
          <div className="segmented small">
            <button className={kind === 'image' ? 'selected' : ''} onClick={() => switchKind('image')}>
              写真
            </button>
            <button className={kind === 'video' ? 'selected' : ''} onClick={() => switchKind('video')}>
              動画
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
            {/* この側に並べる杯を選び直す（写真の真下に付けて、どちらを入れ替えるか分かるように） */}
            <button
              type="button"
              className="compare-label"
              aria-label={`「${label(m, i as Slot) || '選んだ杯'}」をほかの杯と入れ替える`}
              onClick={() => setEditing(i as Slot)}
            >
              {label(m, i as Slot)}
              <ChevronDownIcon size={14} />
            </button>
          </div>
        ))}
        {/* 2杯の間に、何日たったかを渡す */}
        <span className="compare-span">{span}</span>
      </div>

      {kind === 'video' && (
        <button
          type="button"
          className="btn small block"
          onClick={() => {
            for (const p of players.current) p?.playMutedFromStart()
          }}
        >
          <PlayIcon size={16} />
          同時に再生（音なし）
        </button>
      )}

      {editing !== undefined && (
        <CupPickerSheet
          // 押した「最新 ▾」と同じ言葉で、どちらを入れ替えるのかを示す
          title={`「${label(pair[editing], editing) || '選んだ杯'}」と入れ替える杯`}
          // 新しい順に並べる（見比べの左が新しいほう）
          list={[...list].reverse()}
          current={pair[editing].id}
          other={pair[editing === 0 ? 1 : 0].id}
          numberOf={numberOf}
          onPick={pick}
          onClose={() => setEditing(undefined)}
        />
      )}
    </section>
  )
}

/** 片側に並べる杯を選ぶシート。いま選んでいる杯にはチェックを付け、もう片側に並んでいる杯は選べなくする */
function CupPickerSheet({
  title,
  list,
  current,
  other,
  numberOf,
  onPick,
  onClose,
}: {
  title: string
  list: Media[]
  current: string
  /** もう片側に並んでいる杯（同じ杯を2つ並べないよう、選べなくする） */
  other: string
  numberOf: (m: Media) => number | undefined
  onPick: (id: string) => void
  onClose: () => void
}) {
  const latestClose = useRef(onClose)
  latestClose.current = onClose
  // Android の「戻る」は、シートを閉じるだけ（画面ごと戻らない）。シートは保存前のデータを持たないので、確認は出さない
  useBackHandler(() => {
    onClose()
    return true
  })
  // Esc でも閉じる（PC のキーボード）。閉じたら、押した「最新 ▾」にキーボードの位置を戻す
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
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-head">
          <h2>{title}</h2>
          <button type="button" className="btn small" autoFocus onClick={onClose}>
            閉じる
          </button>
        </div>
        <ul className="picker-grid">
          {list.map((m) => (
            <PickerItem
              key={m.id}
              media={m}
              number={numberOf(m)}
              selected={m.id === current}
              disabled={m.id === other}
              onPick={() => onPick(m.id)}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}

function PickerItem({
  media,
  number,
  selected,
  disabled,
  onPick,
}: {
  media: Media
  number?: number
  selected: boolean
  disabled: boolean
  onPick: () => void
}) {
  const url = useCupImageUrl(media, 'pick', { upgrade: false })
  return (
    <li>
      <button
        type="button"
        className={selected ? 'cup-pick selected' : 'cup-pick'}
        aria-label={number ? `No.${number}` : '杯'}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onPick}
      >
        {url ? <img src={url} alt="" /> : <span className="cup-pick-empty" />}
        {!!number && <span className="cup-pick-date">No.{number}</span>}
        {selected && (
          <span className="cup-pick-check" aria-hidden="true">
            <CheckIcon size={14} />
          </span>
        )}
      </button>
    </li>
  )
}

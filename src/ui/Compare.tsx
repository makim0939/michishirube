import { useEffect, useRef, useState } from 'react'
import { youtubeThumbnail } from '../data/youtube'
import { daysBetween, formatDay, spanLabel } from '../domain/format'
import type { Media } from '../domain/types'
import { isVideo, type PlayerControl, saveFile, splitName } from './common'
import { composeCompareImage } from './compareImage'
import { useCupImage, useCupImageUrl } from './cupImage'
import { useToast } from './feedback'
import { MediaItem } from './MediaItem'
import { CheckIcon, PlayIcon, ShareIcon } from './icons'

type Kind = 'video' | 'image'

/**
 * 2杯を並べて、上達を目で見られるようにする。はじめは最新と最初（今日の画面と同じく、新しいほうを左に）。
 * 好きな2杯を選び直すこともでき、並べた2杯を1枚の画像にして送れる
 */
export function Compare({ media, skillName }: { media: Media[]; skillName: string }) {
  const videos = media.filter(isVideo)
  const images = media.filter((m) => !isVideo(m))
  // 2つ以上あって比べられる種類だけを選べるようにする
  const kinds: Kind[] = [...(videos.length >= 2 ? (['video'] as const) : []), ...(images.length >= 2 ? (['image'] as const) : [])]
  const [picked, setPicked] = useState<Kind>()
  /** 選び直した2杯（無ければ最新と最初） */
  const [chosen, setChosen] = useState<string[]>()
  const [picking, setPicking] = useState(false)
  const players = useRef<(PlayerControl | null)[]>([])
  const kind = picked && kinds.includes(picked) ? picked : kinds[0]
  if (!kind) return null

  const list = kind === 'video' ? videos : images
  const byId = new Map(list.map((m) => [m.id, m]))
  const chosenPair = (chosen ?? []).map((id) => byId.get(id)).filter((m): m is Media => !!m)
  const custom = chosenPair.length === 2
  const pair: [Media, Media] = custom
    ? (chosenPair.sort((a, b) => b.createdAt - a.createdAt) as [Media, Media])
    : [list[list.length - 1], list[0]]
  const labels: [string, string] = custom
    ? [formatDay(pair[0].createdAt), formatDay(pair[1].createdAt)]
    : [`最新 ${formatDay(pair[0].createdAt)}`, `最初 ${formatDay(pair[1].createdAt)}`]
  const days = daysBetween(pair[0].createdAt, pair[1].createdAt)
  const span = spanLabel(days)

  const switchKind = (k: Kind) => {
    setPicked(k)
    setChosen(undefined)
    setPicking(false)
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
          <div key={m.id}>
            <MediaItem
              media={m}
              autoLoad
              bare
              playerRef={(p) => {
                players.current[i] = p
              }}
            />
            <p className="compare-label">{labels[i]}</p>
          </div>
        ))}
        {/* 2杯の間に、何日たったかを渡す */}
        <span className="compare-span">{span}</span>
      </div>
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
        <button
          type="button"
          className={`btn small${picking ? ' selected' : ''}`}
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          {picking ? '選び終える' : '2杯を選ぶ'}
        </button>
        <ShareCompareButton
          pair={pair}
          labels={labels}
          title={splitName(skillName).main}
          span={days === 0 ? '同じ日の2杯' : `${days}日で`}
        />
      </div>
      {picking && (
        <CupPicker
          // 新しい順に並べる（見比べの左が新しいほう）
          list={[...list].reverse()}
          selected={pair.map((m) => m.id)}
          onPick={setChosen}
        />
      )}
    </section>
  )
}

/** 見比べる2杯を選ぶ。2杯そろったところで、上の見比べを入れ替える */
function CupPicker({ list, selected, onPick }: { list: Media[]; selected: string[]; onPick: (ids: string[]) => void }) {
  const [sel, setSel] = useState(selected)
  const toggle = (id: string) => {
    // 選んである杯を押すと外す。2杯選んであるときに別の杯を押すと、先に選んだほうと入れ替える
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id].slice(-2)
    setSel(next)
    if (next.length === 2) onPick(next)
  }
  return (
    <div className="cup-picker">
      <p className="muted small">
        {sel.length === 2 ? '押すと入れ替わります' : 'もう1杯選んでください'}
      </p>
      <ul>
        {list.map((m) => (
          <PickerItem key={m.id} media={m} selected={sel.includes(m.id)} onToggle={() => toggle(m.id)} />
        ))}
      </ul>
    </div>
  )
}

function PickerItem({ media, selected, onToggle }: { media: Media; selected: boolean; onToggle: () => void }) {
  const url = useCupImageUrl(media, 'pick', { upgrade: false })
  return (
    <li>
      <button
        type="button"
        className={`cup-pick${selected ? ' selected' : ''}`}
        aria-pressed={selected}
        aria-label={`${formatDay(media.createdAt)}の杯`}
        onClick={onToggle}
      >
        {url ? <img src={url} alt="" /> : <span className="cup-pick-empty" />}
        <span className="cup-pick-date">{formatDay(media.createdAt).slice(5)}</span>
        {selected && (
          <span className="cup-pick-check" aria-hidden="true">
            <CheckIcon size={14} />
          </span>
        )}
      </button>
    </li>
  )
}

/** 見比べに使う絵。写真か動画のサムネイル。端末に無い YouTube の動画は、YouTube のサムネイルを取ってくる */
function useCompareBlob(media: Media): Blob | undefined {
  const blob = useCupImage(media, { upgrade: false })
  const [remote, setRemote] = useState<{ id: string; blob: Blob }>()
  const youtubeId = !blob && isVideo(media) ? media.youtubeId : undefined
  useEffect(() => {
    if (!youtubeId) return
    let cancelled = false
    fetch(youtubeThumbnail(youtubeId))
      .then((res) => (res.ok ? res.blob() : undefined))
      .then((b) => {
        if (!cancelled && b) setRemote({ id: media.id, blob: b })
      })
      .catch(() => {
        // 電波が無ければ、共有のボタンを出さない
      })
    return () => {
      cancelled = true
    }
  }, [media.id, youtubeId])
  return blob ?? (remote?.id === media.id ? remote.blob : undefined)
}

/**
 * 並べた2杯を1枚の画像にして、写真アプリに保存したり送ったりする。
 * 共有シートを開くには押した直後である必要があるので、画像は先に作っておく
 */
function ShareCompareButton({
  pair,
  labels,
  title,
  span,
}: {
  pair: [Media, Media]
  labels: [string, string]
  title: string
  span: string
}) {
  const toast = useToast()
  const a = useCompareBlob(pair[0])
  const b = useCompareBlob(pair[1])
  const key = [pair[0].id, pair[1].id, a?.size, b?.size, ...labels, title, span].join('|')
  const [ready, setReady] = useState<{ key: string; file: File }>()

  useEffect(() => {
    if (!a || !b) return
    let cancelled = false
    composeCompareImage(
      [
        { blob: a, label: labels[0] },
        { blob: b, label: labels[1] },
      ],
      title,
      span,
    )
      .then((blob) => {
        if (!cancelled) setReady({ key, file: new File([blob], `latte-compare-${Date.now()}.jpg`, { type: 'image/jpeg' }) })
      })
      .catch(() => {
        // 作れなければ、押したときに知らせる
      })
    return () => {
      cancelled = true
    }
    // 2杯と見出しが同じ間は作り直さない
  }, [key])

  if (!a || !b) return null
  const file = ready?.key === key ? ready.file : undefined

  const share = async () => {
    if (!file) {
      toast.show('画像を用意しています。少し待ってから押してください')
      return
    }
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (!touch || !navigator.canShare?.({ files: [file] })) {
      await saveFile(file, file.name)
      return
    }
    try {
      await navigator.share({ files: [file] })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      toast.show('共有できませんでした', 'error')
    }
  }

  return (
    <button type="button" className="btn small" onClick={() => void share()}>
      <ShareIcon size={16} />
      共有
    </button>
  )
}

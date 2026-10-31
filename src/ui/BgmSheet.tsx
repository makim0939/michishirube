import { useEffect, useRef, useState } from 'react'
import { BUNDLED_BGM, formatSeconds, type BgmChoice } from '../data/bgm'
import { t } from '../i18n'
import { PauseIcon, PlayIcon } from './icons'
import { useBackHandler } from './useBackHandler'

/**
 * BGM を選ぶシート（画面の下から出る一覧。YouTube ショート・Instagram のリール・CapCut の「音楽」と同じ形）。
 * 先頭は「なし」。曲の行を押すと、選んで閉じる。行の右の ▶ は、選ばずに聴くだけ（1 つずつ流れる）
 */
export function BgmSheet({
  current,
  onPick,
  onFile,
  onClose,
}: {
  current: BgmChoice | undefined
  /** 曲（同梱）か、「なし」（undefined）を選んだ */
  onPick: (choice: BgmChoice | undefined) => void
  /** 「ファイルから選ぶ」を押した（ファイルの選択は呼び出し側が開く） */
  onFile: () => void
  onClose: () => void
}) {
  const [listening, setListening] = useState<string>()
  const audio = useRef<HTMLAudioElement | undefined>(undefined)
  useBackHandler(() => {
    onClose()
    return true
  })

  const stop = () => {
    audio.current?.pause()
    audio.current = undefined
    setListening(undefined)
  }
  // 閉じたら、試聴を止める
  useEffect(() => () => audio.current?.pause(), [])

  const toggleListen = (id: string, path: string) => {
    if (listening === id) {
      stop()
      return
    }
    audio.current?.pause()
    const el = new Audio(`${import.meta.env.BASE_URL}${path}`)
    el.loop = true
    audio.current = el
    setListening(id)
    void el.play().catch(() => setListening((x) => (x === id ? undefined : x)))
  }

  const currentId = current?.kind === 'bundled' ? current.track.id : undefined
  const isFile = current?.kind === 'file'

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker-sheet bgm-sheet" role="dialog" aria-modal="true" aria-label={t.compose.bgm} onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <h2>{t.compose.bgm}</h2>
          <button type="button" className="btn small" onClick={onClose}>
            {t.common.close}
          </button>
        </div>
        <ul className="bgm-sheet-list">
          <li>
            <button type="button" aria-current={!current} className="bgm-pick" onClick={() => onPick(undefined)}>
              <span className="bgm-name">{t.compose.bgmOff}</span>
              {!current && <Check />}
            </button>
          </li>
          {BUNDLED_BGM.map((track) => (
            <li key={track.id} className="bgm-track">
              <button type="button" aria-current={currentId === track.id} className="bgm-pick" onClick={() => onPick({ kind: 'bundled', track })}>
                <span className="bgm-name">{track.title}</span>
                <span className="bgm-len">{formatSeconds(track.seconds)}</span>
                {currentId === track.id && <Check />}
              </button>
              <button
                type="button"
                className="bgm-listen"
                aria-label={listening === track.id ? t.compose.bgmStopListen : t.compose.bgmListen}
                aria-pressed={listening === track.id}
                onClick={() => toggleListen(track.id, track.path)}
              >
                {listening === track.id ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
              </button>
            </li>
          ))}
          <li>
            <button type="button" aria-current={isFile} className="bgm-pick" onClick={() => { stop(); onFile() }}>
              <span className="bgm-name">{isFile ? current.file.name.replace(/\.[^.]+$/, '') : t.compose.bgmFile}</span>
              {isFile && <Check />}
            </button>
          </li>
        </ul>
      </div>
    </div>
  )
}

function Check() {
  return (
    <svg className="bgm-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { youtubeUrl } from '../data/youtube'
import { type PlayerControl, useObjectUrl } from './common'
import { PauseIcon, PlayIcon, SpeakerIcon } from './icons'

/**
 * 端末から消えた動画を、アプリの中で YouTube から再生する（限定公開の動画を埋め込む）。
 * YouTube の操作ボタンは出さず、アプリの再生ボタン・つまみで操作する。
 * 枠は正方形で、動画を枠いっぱいに広げて真ん中を見せる（端末の動画と同じ見え方。上のタイトルや下のロゴもはみ出して隠れる）
 */

interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  mute(): void
  unMute(): void
  setPlaybackRate(rate: number): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  destroy(): void
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string
      host?: string
      width?: string
      height?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: () => void
        onStateChange?: (e: { data: number }) => void
        onError?: (e: { data: number }) => void
      }
    },
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const STATE = { ended: 0, playing: 1, paused: 2, buffering: 3 } as const

let api: Promise<YTNamespace> | undefined

/** YouTube の再生の仕組み（IFrame Player API）を1回だけ読み込む */
function loadApi(): Promise<YTNamespace> {
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT!)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      // 電波が戻ったら、次に開いたときに読み込み直す
      api = undefined
      script.remove()
      reject(new Error('YouTube を読み込めませんでした'))
    }
    document.head.appendChild(script)
  })
  return api
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 縦横比（高さ ÷ 幅）。サムネイルから読む。無ければ iPhone を縦に持って撮った動画とみなす */
function useAspect(posterUrl: string | undefined): number {
  const [aspect, setAspect] = useState(16 / 9)
  useEffect(() => {
    if (!posterUrl) return
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalHeight / img.naturalWidth)
    }
    img.src = posterUrl
  }, [posterUrl])
  return aspect
}

/** 正方形の枠に、動画を枠いっぱいに広げて真ん中に置く（object-fit: cover と同じ） */
function coverStyle(aspect: number): CSSProperties {
  if (aspect >= 1) return { width: '100%', height: `${aspect * 100}%`, left: 0, top: `${((1 - aspect) / 2) * 100}%` }
  return { height: '100%', width: `${100 / aspect}%`, top: 0, left: `${((1 - 1 / aspect) / 2) * 100}%` }
}

export function YoutubePlayer({
  videoId,
  poster,
  cacheKey,
  playerRef,
}: {
  videoId: string
  poster?: Blob
  cacheKey: string
  playerRef?: (p: PlayerControl | null) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(false)
  /** 再生を押してから始まるまで */
  const [waiting, setWaiting] = useState(false)
  /** 最後まで見て、はじめに戻している途中 */
  const rewinding = useRef(false)
  const [muted, setMuted] = useState(false)
  const [slow, setSlow] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const posterUrl = useObjectUrl(poster, poster ? `${cacheKey}-yt-${poster.size}` : undefined)
  const aspect = useAspect(posterUrl)
  const latestRef = useRef(playerRef)
  latestRef.current = playerRef

  useEffect(() => {
    let cancelled = false
    let created: YTPlayer | null = null
    loadApi()
      .then((YT) => {
        if (cancelled || !frame.current) return
        // YouTube は渡した要素を iframe に置き換えるので、React が持たない要素を中に作って渡す
        const el = document.createElement('div')
        frame.current.appendChild(el)
        created = new YT.Player(el, {
          videoId,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: {
            controls: 0,
            playsinline: 1,
            rel: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled) return
              player.current = created
              setReady(true)
              setDuration(created!.getDuration())
              latestRef.current?.({
                playMutedFromStart: () => {
                  setWaiting(true)
                  rewinding.current = false
                  created!.mute()
                  setMuted(true)
                  created!.seekTo(0, true)
                  created!.playVideo()
                },
              })
            },
            onStateChange: (e) => {
              if (cancelled) return
              if (e.data === STATE.playing) {
                // はじめに戻している途中で動き出したら、止める
                if (rewinding.current) {
                  created!.pauseVideo()
                  return
                }
                setStarted(true)
                setPlaying(true)
                setWaiting(false)
                setDuration(created!.getDuration())
              } else if (e.data === STATE.paused) {
                setPlaying(false)
                setWaiting(false)
                rewinding.current = false
              } else if (e.data === STATE.ended) {
                // 最後まで見たら、はじめに戻して止め、再生前の絵に戻す（YouTube のおすすめ動画を出さない）
                rewinding.current = true
                created!.seekTo(0, true)
                created!.pauseVideo()
                setPlaying(false)
                setStarted(false)
                setTime(0)
              }
            },
            onError: () => {
              if (!cancelled) setFailed(true)
            },
          },
        })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      latestRef.current?.(null)
      player.current = null
      created?.destroy()
      if (frame.current) frame.current.textContent = ''
    }
  }, [videoId])

  // 再生中は、つまみの位置を進める
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      if (player.current) setTime(player.current.getCurrentTime())
    }, 200)
    return () => clearInterval(timer)
  }, [playing])

  const play = () => {
    const p = player.current
    if (!p) return
    setWaiting(true)
    rewinding.current = false
    p.playVideo()
    // iPhone では、音つきの再生が止められることがある。始まらなければ音を消して再生する（音は右下で出せる）
    setTimeout(() => {
      if (player.current !== p) return
      const state = p.getPlayerState()
      if (state !== STATE.playing && state !== STATE.buffering) {
        p.mute()
        setMuted(true)
        p.playVideo()
      }
    }, 1200)
  }

  if (failed) {
    return (
      <a
        className={`media placeholder${posterUrl ? ' with-poster' : ''}`}
        style={posterUrl ? { backgroundImage: `url(${posterUrl})` } : undefined}
        href={youtubeUrl(videoId)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <PlayIcon size={22} />
        YouTube で見る
        <small>アプリの中で再生できませんでした</small>
      </a>
    )
  }

  return (
    <div className="media yt-player">
      <div ref={frame} className="yt-frame" style={coverStyle(aspect)} />
      {/* 動画の上を押したときは、YouTube ではなくアプリで受ける（YouTube の画面へ移ってしまわないように） */}
      <button
        type="button"
        className={`yt-surface${started ? '' : ' cover'}`}
        style={!started && posterUrl ? { backgroundImage: `url(${posterUrl})` } : undefined}
        aria-label={playing ? '一時停止' : '動画を再生'}
        disabled={!ready}
        onClick={() => (playing ? player.current?.pauseVideo() : play())}
      >
        {!started && <span className="yt-play">{ready && !waiting ? <PlayIcon size={22} /> : '…'}</span>}
      </button>
      {started && (
        <div className="yt-controls">
          <button
            type="button"
            className="yt-control"
            aria-label={playing ? '一時停止' : '再生'}
            onClick={() => (playing ? player.current?.pauseVideo() : player.current?.playVideo())}
          >
            {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>
          <input
            type="range"
            className="yt-seek"
            aria-label="再生位置"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(time, duration || 1)}
            onChange={(e) => {
              const t = Number(e.target.value)
              setTime(t)
              player.current?.seekTo(t, true)
            }}
          />
          <span className="yt-time">{formatTime(time)}</span>
          <button
            type="button"
            className={`yt-control yt-rate${slow ? ' on' : ''}`}
            aria-pressed={slow}
            aria-label="スロー再生"
            onClick={() => {
              player.current?.setPlaybackRate(slow ? 1 : 0.5)
              setSlow(!slow)
            }}
          >
            0.5×
          </button>
          <button
            type="button"
            className="yt-control"
            aria-label={muted ? '音を出す' : '音を消す'}
            onClick={() => {
              if (muted) player.current?.unMute()
              else player.current?.mute()
              setMuted(!muted)
            }}
          >
            <SpeakerIcon size={18} off={muted} />
          </button>
        </div>
      )}
    </div>
  )
}

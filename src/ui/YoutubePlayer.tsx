import { useEffect, useRef, useState } from 'react'
import { youtubeThumbnail, youtubeUrl } from '../data/youtube'
import { type PlayerControl, useObjectUrl } from './common'
import { PauseIcon, PlayIcon, SpeakerIcon } from './icons'

/**
 * 端末から消えた動画を、アプリの中で YouTube から再生する（限定公開の動画を埋め込む）。
 * YouTube の操作ボタンは出さず、アプリの再生ボタン・つまみで操作する。
 * 端末の動画と同じく、再生前はサムネイルを正方形の枠いっぱいに、再生中は縦の動画全体を枠に収めて見せる
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

const STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3 } as const

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
  /** 再生を押してから、読み込み・再生が始まったか（始まらなければ、音つきの再生が止められたとみなす） */
  const responded = useRef(false)
  /** 見比べで音を消して再生した。止めたら音を戻す（そのあと1本だけ再生したときに音が出るように） */
  const unmuteOnPause = useRef(false)
  const [muted, setMuted] = useState(false)
  const [slow, setSlow] = useState(false)
  /** 再生中は、操作のバーを少しすると隠す（動画を覆わないように）。押すとまた出す */
  const [controlsShown, setControlsShown] = useState(true)
  /** 操作した回数。触るたびに、バーを隠すまでの時間を数え直す */
  const [activity, setActivity] = useState(0)
  const showControls = () => {
    setControlsShown(true)
    setActivity((n) => n + 1)
  }
  /** バーを押さえている（つまみを動かしている）間は隠さない */
  const [holding, setHolding] = useState(false)
  const controls = useRef<HTMLDivElement>(null)
  /** つまみを動かし終えたら、その位置から読み込む */
  const seekTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const localPoster = useObjectUrl(poster, poster ? `${cacheKey}-yt-${poster.size}` : undefined)
  const posterUrl = localPoster ?? youtubeThumbnail(videoId)
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
                  unmuteOnPause.current = true
                  created!.mute()
                  setMuted(true)
                  created!.seekTo(0, true)
                  created!.playVideo()
                },
              })
            },
            onStateChange: (e) => {
              if (cancelled) return
              if (e.data === STATE.playing || e.data === STATE.buffering) responded.current = true
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
              } else if (e.data === STATE.unstarted && responded.current) {
                // 読み込みまで進んだのに、始まる前に戻った（再生が止められた）。「…」のままにせず、再生ボタンに戻す
                setWaiting(false)
              } else if (e.data === STATE.paused) {
                setPlaying(false)
                setWaiting(false)
                rewinding.current = false
                if (unmuteOnPause.current) {
                  unmuteOnPause.current = false
                  created!.unMute()
                  setMuted(false)
                }
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
              if (cancelled) return
              // 再生できない動画。YouTube の画面へのリンクに切り替え、プレーヤーはすぐ片付ける
              player.current = null
              created?.destroy()
              created = null
              setFailed(true)
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

  // 再生中に何も触らなければ、操作のバーを隠す（iPhone の動画と同じ）
  useEffect(() => {
    if (!playing || !controlsShown || holding) return
    const timer = setTimeout(() => {
      // バーの中のボタンを選んでいる（キーボード・読み上げ）ときは隠さない
      if (!controls.current?.contains(document.activeElement)) setControlsShown(false)
    }, 2500)
    return () => clearTimeout(timer)
  }, [playing, controlsShown, holding, activity])

  useEffect(() => () => clearTimeout(seekTimer.current), [])

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
    showControls()
    rewinding.current = false
    responded.current = false
    p.playVideo()
    // iPhone では、音つきの再生が止められることがある。読み込みも始まらなければ、音を消して再生する（音は右下で出せる）。
    // 電波が遅くても、読み込みが始まっていれば（buffering）待つ
    setTimeout(() => {
      if (player.current !== p || responded.current) return
      p.mute()
      setMuted(true)
      p.playVideo()
    }, 2000)
  }

  if (failed) {
    return (
      <a
        className="media placeholder with-poster"
        style={{ backgroundImage: `url(${posterUrl})` }}
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
      <div ref={frame} className="yt-frame" />
      {/* 動画の上を押したときは、YouTube ではなくアプリで受ける（YouTube の画面へ移ってしまわないように） */}
      <button
        type="button"
        className={`yt-surface${started ? '' : ' cover'}`}
        style={!started ? { backgroundImage: `url(${posterUrl})` } : undefined}
        aria-label={playing ? (controlsShown ? '一時停止' : '操作を表示') : '動画を再生'}
        disabled={!ready}
        onClick={() => {
          // バーを隠しているときは、まずバーを出す（いきなり止めない）
          if (playing && !controlsShown) showControls()
          else if (playing) player.current?.pauseVideo()
          else play()
        }}
      >
        {!started && <span className="yt-play">{ready && !waiting ? <PlayIcon size={44} /> : '…'}</span>}
      </button>
      {started && (controlsShown || !playing) && (
        <div
          ref={controls}
          className="yt-controls"
          onPointerDown={() => {
            showControls()
            setHolding(true)
          }}
          onPointerUp={() => setHolding(false)}
          onPointerCancel={() => setHolding(false)}
        >
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
              // 動かしている間は、読み込みを待たずに今あるところだけを見せる。
              // 止めたら（指を離した・スクロールに変わった・キーで動かした、のどれでも）、その位置から読み込む
              player.current?.seekTo(t, false)
              clearTimeout(seekTimer.current)
              seekTimer.current = setTimeout(() => player.current?.seekTo(t, true), 300)
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

import { useEffect, useRef, useState, type RefObject } from 'react'
import { isAndroidApp, isIosApp } from '../platform'

/**
 * 映像が止まる不具合（音だけ流れる）を、実機で調べるための診断。ふだんは出さない。
 * 「仕上げる」画面の時間表示を長押しで出し入れする（保存しない。画面を閉じたら消える）。
 * 出していない間は、動画の購読も、記録も、何もしない。読むだけで、動画の動作は変えない。
 * 個人情報（ファイル名・パス・記録の中身）は入れない。送信もしない（コピーしたものを、利用者が貼る）
 */

/** 長押しで出し入れするまでの長さ（ms） */
export const DIAG_HOLD_MS = 1500

const KEEP = 60
let active = false
let started = 0
const lines: string[] = []

/** 診断を出している間だけ、経過を残す（出していないときは、何もしない） */
export function diagLog(msg: string) {
  if (!active) return
  lines.push(`${((performance.now() - started) / 1000).toFixed(2)} ${msg}`)
  if (lines.length > KEEP) lines.splice(0, lines.length - KEEP)
}

/** play() が断られたとき（いまは握りつぶしている）に、理由を残す */
export function diagPlayRejected(e: unknown) {
  diagLog(`play() 拒否 ${e instanceof Error ? e.name : String(e)}`)
}

/** 画面の外から渡す、動画のまわりの状態（動画そのものの状態は、video から読む） */
export interface DiagInfo {
  /** 動画の渡し方：ファイルの URL か、メモリに写した Blob か */
  source: 'file' | 'blob'
  clips: number
  segments: number
  /** 帯の絵づくりが動いているか */
  filmstrip: boolean
  bgm: boolean
  muted: boolean
  texts: number
}

const EVENTS = ['play', 'playing', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'error', 'emptied', 'ended', 'loadeddata', 'suspend']

function platformName() {
  return isIosApp ? 'iOS アプリ' : isAndroidApp ? 'Android アプリ' : 'Web'
}

/** クリップボードへ。できたか */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 許可されない・使えないときは、選択して写す
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  return ok
}

export function VideoDiag({ video, info, onClose }: { video: RefObject<HTMLVideoElement | null>; info: () => DiagInfo; onClose: () => void }) {
  const [text, setText] = useState('')
  const [copied, setCopied] = useState<'ok' | 'ng'>()
  const textRef = useRef('')

  useEffect(() => {
    active = true
    started = performance.now()
    lines.length = 0
    const v = video.current
    if (!v) return
    // 古い WebView には無い（その端末では、コマ数は「—」）
    const hasFrames = 'requestVideoFrameCallback' in v
    const counts: Record<string, number> = {}
    let frames: number[] = []
    let sincePlay: number | null = null
    let startMs: number | null = null
    let maxStartMs = 0
    let gaps = 0
    /** 前回の確認からの、シークの回数（区間を飛ぶ・位置を動かしたときは、currentTime が一気に進んでも、途切れではない） */
    let seeks = 0
    let lastCheck = { t: v.currentTime, f: 0, at: performance.now() }
    let total = 0
    const onEvent = (e: Event) => {
      counts[e.type] = (counts[e.type] ?? 0) + 1
      if (e.type === 'seeking') seeks++
      if (e.type === 'play') sincePlay = performance.now()
      if (e.type === 'pause') sincePlay = null
      // 軽い出来事（suspend・loadeddata）は、回数だけ。経過には、止まりに関わるものを残す
      if (e.type !== 'suspend') diagLog(`${e.type} t=${v.currentTime.toFixed(2)} rs=${v.readyState}${v.error ? ` err=${v.error.code}` : ''}`)
    }
    for (const ev of EVENTS) v.addEventListener(ev, onEvent)

    // 実際に映像のコマが出たか（currentTime が進んでいても、コマが出ていなければ、映像だけ止まっている）
    let id = 0
    const onFrame = () => {
      const now = performance.now()
      total++
      frames.push(now)
      if (sincePlay !== null) {
        // play() から、最初のコマが出るまで
        startMs = now - sincePlay
        maxStartMs = Math.max(maxStartMs, startMs)
        diagLog(`再生の開始まで ${Math.round(startMs)}ms`)
        sincePlay = null
      }
      id = v.requestVideoFrameCallback(onFrame)
    }
    if (hasFrames) id = v.requestVideoFrameCallback(onFrame)

    const timer = window.setInterval(() => {
      const now = performance.now()
      frames = frames.filter((x) => now - x < 1000)
      // 再生中に、currentTime は進むのに、コマが 0.7 秒以上出ない
      if (!v.paused && hasFrames) {
        const dT = v.currentTime - lastCheck.t
        if (now - lastCheck.at >= 700) {
          if (dT > 0.3 && total === lastCheck.f && seeks === 0) {
            gaps++
            diagLog(`映像のコマが来ない（currentTime +${dT.toFixed(2)}s）`)
          }
          lastCheck = { t: v.currentTime, f: total, at: now }
          seeks = 0
        }
      } else {
        lastCheck = { t: v.currentTime, f: total, at: now }
        seeks = 0
      }
      const i = info()
      const head = [
        `rs ${v.readyState}  ns ${v.networkState}  t ${v.currentTime.toFixed(2)}  ${v.paused ? '停止' : '再生中'}${v.seeking ? '  シーク中' : ''}`,
        `コマ/秒 ${hasFrames ? frames.length : '—'}  開始まで ${startMs === null ? '—' : `${Math.round(startMs)}ms`}（最大 ${Math.round(maxStartMs)}ms）`,
        `waiting ${counts.waiting ?? 0}  stalled ${counts.stalled ?? 0}  error ${counts.error ?? 0}  コマ途切れ ${gaps}`,
        `${i.source === 'file' ? 'ファイル' : 'メモリ'}  動画${i.clips}本 区間${i.segments}  絵づくり${i.filmstrip ? '中' : '済'}  BGM${i.bgm ? 'あり' : 'なし'}  ${i.muted ? '音なし' : '音あり'}  文字${i.texts}`,
      ].join('\n')
      textRef.current = `${head}\n\n${platformName()}\n${navigator.userAgent}\n\n${lines.join('\n')}`
      setText(head)
    }, 250)
    return () => {
      active = false
      lines.length = 0
      window.clearInterval(timer)
      for (const ev of EVENTS) v.removeEventListener(ev, onEvent)
      if (id) v.cancelVideoFrameCallback(id)
    }
  }, [video, info])

  return (
    <div className="video-diag" role="status">
      <pre>{text}</pre>
      <div className="video-diag-buttons">
        <button
          type="button"
          onClick={() => {
            void copyText(textRef.current).then((ok) => {
              setCopied(ok ? 'ok' : 'ng')
              window.setTimeout(() => setCopied(undefined), 1500)
            })
          }}
        >
          {copied === 'ok' ? 'コピーした' : copied === 'ng' ? 'できません' : 'コピー'}
        </button>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}

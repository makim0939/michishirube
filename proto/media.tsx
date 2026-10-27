import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { segAt, type Seg } from './model'

// ---- 小さな絵（フィルム・カードの絵）：画面に出さない video で、順に 1 コマずつ取る ----
const hidden = new Map<string, HTMLVideoElement>()
let chain: Promise<unknown> = Promise.resolve()

function hiddenVideo(url: string): Promise<HTMLVideoElement> {
  let v = hidden.get(url)
  if (!v) {
    v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = url
    hidden.set(url, v)
  }
  const el = v
  if (el.readyState >= 2) return Promise.resolve(el)
  return new Promise((res) => el.addEventListener('loadeddata', () => res(el), { once: true }))
}

const cache = new Map<string, string>()

export function frameAt(url: string, t: number, w = 72): Promise<string> {
  const key = `${url}|${t.toFixed(2)}|${w}`
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const run = async () => {
    const v = await hiddenVideo(url)
    const time = Math.max(0, Math.min(v.duration - 0.05, t))
    if (Math.abs(v.currentTime - time) > 0.001) {
      await new Promise<void>((res) => {
        v.addEventListener('seeked', () => res(), { once: true })
        v.currentTime = time
      })
    }
    const h = Math.round((w * v.videoHeight) / v.videoWidth)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(v, 0, 0, w, h)
    const data = c.toDataURL('image/jpeg', 0.6)
    cache.set(key, data)
    return data
  }
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

/** 動画を n 等分した位置の絵 */
export function useFrames(url: string, dur: number, n: number): string[] {
  const [frames, setFrames] = useState<string[]>([])
  useEffect(() => {
    let off = false
    setFrames([])
    void (async () => {
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        out.push(await frameAt(url, ((i + 0.5) / n) * dur))
        if (off) return
        if (i % 3 === 2 || i === n - 1) setFrames([...out])
      }
    })()
    return () => {
      off = true
    }
  }, [url, dur, n])
  return frames
}

export function Thumb({ url, t, className }: { url: string; t: number; className?: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let off = false
    void frameAt(url, t, 96).then((s) => !off && setSrc(s))
    return () => {
      off = true
    }
  }, [url, Math.round(t * 5)])
  return src ? <img className={className} src={src} alt="" /> : <span className={className} />
}

export function Film({ url, dur, n }: { url: string; dur: number; n: number }) {
  const frames = useFrames(url, dur, n)
  return (
    <div className="p-film" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (frames[i] ? <img key={i} src={frames[i]} alt="" /> : <span key={i} />))}
    </div>
  )
}

// ---- 再生：外した区間は、飛ばして再生する（書き出しと同じ見え方） ----
export function usePlayer(segsRef: MutableRefObject<Seg[]>) {
  const v = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    let id = 0
    const tick = () => {
      const el = v.current
      if (el) {
        setTime(el.currentTime)
        if (!el.paused) {
          const segs = segsRef.current
          const s = segAt(segs, el.currentTime)
          if (s?.off) {
            const next = segs.find((x) => !x.off && x.start >= s.end - 1e-6)
            if (next) el.currentTime = next.start
            else el.pause()
          }
        }
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [segsRef])
  useEffect(() => {
    const el = v.current
    if (!el) return
    const on = () => setPlaying(true)
    const off = () => setPlaying(false)
    el.addEventListener('play', on)
    el.addEventListener('pause', off)
    el.addEventListener('ended', off)
    return () => {
      el.removeEventListener('play', on)
      el.removeEventListener('pause', off)
      el.removeEventListener('ended', off)
    }
  }, [])
  const seek = (t: number) => {
    const el = v.current
    if (!el) return
    el.currentTime = t
    setTime(t)
  }
  const play = (from?: number) => {
    const el = v.current
    if (!el) return
    if (from !== undefined) el.currentTime = from
    else if (el.ended || el.currentTime >= el.duration - 0.05) el.currentTime = 0
    void el.play()
  }
  const pause = () => v.current?.pause()
  return { v, time, playing, seek, play, pause, toggle: () => (playing ? pause() : play()) }
}

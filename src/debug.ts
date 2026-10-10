/**
 * iPhone の Safari では開発者ツールを使いにくいので、URL に ?debug を付けたときだけ、
 * 動画まわりの処理の経過を画面に出す（ふだんは何もしない）
 */

export const debugEnabled = typeof location !== 'undefined' && /[?&]debug\b/.test(location.search)

const lines: string[] = []
const listeners = new Set<() => void>()
const started = typeof performance !== 'undefined' ? performance.now() : 0

export function dlog(...parts: unknown[]) {
  if (!debugEnabled) return
  const t = ((performance.now() - started) / 1000).toFixed(2)
  lines.push(`${t} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`)
  if (lines.length > 40) lines.splice(0, lines.length - 40)
  listeners.forEach((l) => l())
}

export function debugLines(): string[] {
  return lines
}

export function onDebug(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** video の主なイベントを記録する */
export function traceVideo(video: HTMLVideoElement, label: string): () => void {
  if (!debugEnabled) return () => {}
  const events = ['loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'ended', 'error']
  const handler = (e: Event) =>
    dlog(`${label}:${e.type} t=${video.currentTime.toFixed(2)} rs=${video.readyState} p=${video.paused}${video.error ? ` err=${video.error.message}` : ''}`)
  for (const ev of events) video.addEventListener(ev, handler)
  return () => events.forEach((ev) => video.removeEventListener(ev, handler))
}

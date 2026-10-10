import { useEffect, useState } from 'react'
import { debugEnabled, debugLines, onDebug } from '../debug'

/** ?debug のときだけ、画面の下に処理の経過を出す */
export function DebugOverlay() {
  const [, setTick] = useState(0)
  useEffect(() => onDebug(() => setTick((n) => n + 1)), [])
  if (!debugEnabled) return null
  return (
    <pre className="debug-overlay" aria-hidden="true">
      {debugLines().slice(-14).join('\n')}
    </pre>
  )
}

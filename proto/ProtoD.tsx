import { useEffect, useRef, useState } from 'react'
import { frameAt, Thumb, usePlayer } from './media'
import { fmt, kept, newId, toggleOff, total, useSegs, type Seg } from './model'
import { Shell } from './Shell'
import type { ProtoProps } from './types'

const FPS = 4
const SW = 24
const SH = 42

/** 動画を FPS コマ／秒でなめて、前のコマとの違い（0〜1）を取る。場面の変わり目は、違いが大きい */
async function measure(url: string, dur: number, progress: (r: number) => void): Promise<number[]> {
  const n = Math.floor(dur * FPS)
  const c = document.createElement('canvas')
  c.width = SW
  c.height = SH
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  let prev: Uint8ClampedArray | null = null
  const diffs: number[] = []
  for (let i = 0; i < n; i++) {
    const img = new Image()
    img.src = await frameAt(url, i / FPS, SW)
    await img.decode()
    ctx.drawImage(img, 0, 0, SW, SH)
    const d = ctx.getImageData(0, 0, SW, SH).data
    if (prev) {
      let sum = 0
      for (let k = 0; k < d.length; k += 4) sum += Math.abs(d[k] - prev[k]) + Math.abs(d[k + 1] - prev[k + 1]) + Math.abs(d[k + 2] - prev[k + 2])
      diffs.push(sum / ((d.length / 4) * 3 * 255))
    } else diffs.push(0)
    prev = d
    if (i % 8 === 0) progress(i / n)
  }
  return diffs
}

/** 違いが threshold を超えたコマを、場面の変わり目にする（近すぎるものは、まとめる） */
function toScenes(diffs: number[], dur: number, threshold: number): Seg[] {
  const cuts: number[] = []
  diffs.forEach((d, i) => {
    const t = i / FPS
    if (d > threshold && t > 0.8 && dur - t > 0.8 && (!cuts.length || t - cuts[cuts.length - 1] >= 1.2)) cuts.push(t)
  })
  const edges = [0, ...cuts, dur]
  return edges.slice(0, -1).map((s, i) => ({ id: newId(), start: s, end: edges[i + 1], off: false }))
}

/**
 * 案 D：場面を自動で分ける。
 * 動画の中で、絵が大きく変わるところを場面の変わり目にして、場面ごとに「残す／外す」だけを選ぶ。
 * 手で位置を合わせない（人の手の操作は、スイッチだけ）。撮り方によっては、分けきれない（感度で調整・場面が合わないときは、案 B の手動が必要）。
 */
export function ProtoD({ url, dur, mode, onRanges, onDone, onDiscard, onSoftClose }: ProtoProps) {
  const h = useSegs(dur)
  const segsRef = useRef(h.segs)
  segsRef.current = h.segs
  const p = usePlayer(segsRef)
  const [diffs, setDiffs] = useState<number[]>()
  const [progress, setProgress] = useState(0)
  const [sens, setSens] = useState(0.5)

  useEffect(() => {
    let off = false
    void measure(url, dur, (r) => !off && setProgress(r)).then((d) => !off && setDiffs(d))
    return () => {
      off = true
    }
  }, [url, dur])

  // 感度：大きいほど、細かく分ける（違いの目安を、平均＋標準偏差の何倍にするか）
  const threshold = (() => {
    if (!diffs) return 1
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length
    const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length)
    return mean + sd * (4 - 3.4 * sens)
  })()
  useEffect(() => {
    if (diffs) h.set(() => toScenes(diffs, dur, threshold), false)
  }, [diffs, threshold])
  useEffect(() => {
    onRanges(kept(h.segs).map((s) => ({ start: s.start, end: s.end })))
  }, [h.segs])

  const [touched, setTouched] = useState(false)
  const [playingId, setPlayingId] = useState<string>()
  useEffect(() => {
    if (!p.playing) setPlayingId(undefined)
  }, [p.playing])

  return (
    <Shell mode={mode} dirty={touched} length={fmt(total(h.segs))} onDone={onDone} onDiscard={onDiscard} onSoftClose={onSoftClose}>
      <div className="p-stage small">
        <video ref={p.v} src={url} playsInline preload="auto" onClick={p.toggle} />
      </div>
      {!diffs ? (
        <p className="p-hint">場面を探しています… {Math.round(progress * 100)}%</p>
      ) : (
        <>
          <div className="p-row">
            <span className="p-mute">{h.segs.length} 場面</span>
            <label className="p-zoom">
              細かさ
              <input type="range" min={0} max={1} step={0.05} value={sens} onChange={(e) => setSens(Number(e.target.value))} />
            </label>
          </div>
          <ul className="p-cards">
            {h.segs.map((s, i) => (
              <li key={s.id} className={`p-card${s.off ? ' off' : ''}${playingId === s.id ? ' playing' : ''}`}>
                <button
                  className="p-card-thumb"
                  aria-label={`${i + 1} を見る`}
                  onClick={() => {
                    setPlayingId(s.id)
                    p.play(s.start)
                    // この場面の終わりで止める
                    const stop = () => {
                      const el = p.v.current
                      if (el && el.currentTime >= s.end) {
                        el.pause()
                        el.removeEventListener('timeupdate', stop)
                      }
                    }
                    p.v.current?.addEventListener('timeupdate', stop)
                  }}
                >
                  <Thumb url={url} t={s.start + 0.1} />
                  <span className="p-card-play">▶</span>
                </button>
                <div className="p-card-body">
                  <b>{i + 1}</b>
                  <span>{fmt(s.end - s.start)}</span>
                </div>
                <button
                  className={`p-switch${s.off ? '' : ' on'}`}
                  role="switch"
                  aria-checked={!s.off}
                  aria-label={s.off ? '戻す' : '外す'}
                  disabled={!s.off && kept(h.segs).length <= 1}
                  onClick={() => {
                    setTouched(true)
                    h.set((x) => toggleOff(x, s.id), false)
                  }}
                >
                  <span />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  )
}

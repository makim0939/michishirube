import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/styles.css'
import './proto.css'
import { fmt } from './model'
import { ProtoA } from './ProtoA'
import { ProtoB } from './ProtoB'
import { ProtoC } from './ProtoC'
import { ProtoD } from './ProtoD'
import type { ConfirmMode } from './Shell'
import type { Range } from './types'

const PROTOS = {
  a: { name: 'A 切り出して集める', C: ProtoA },
  b: { name: 'B タイムライン', C: ProtoB },
  c: { name: 'C 見ながら押す', C: ProtoC },
  d: { name: 'D 場面を自動で分ける', C: ProtoD },
} as const
type Key = keyof typeof PROTOS

const q = new URLSearchParams(location.search)
const setQ = (k: string, v: string) => {
  const n = new URLSearchParams(location.search)
  n.set(k, v)
  location.search = n.toString()
}

function App() {
  const key = (q.get('proto') as Key) in PROTOS ? (q.get('proto') as Key) : 'b'
  const mode = (['inline', 'sheet', 'undo'].includes(q.get('confirm') ?? '') ? q.get('confirm') : 'inline') as ConfirmMode
  const [url, setUrl] = useState(`${import.meta.env.BASE_URL}sample.mp4`)
  const [dur, setDur] = useState(0)
  const [ranges, setRanges] = useState<Range[]>([])
  const [epoch, setEpoch] = useState(0)
  const [taps, setTaps] = useState(0)
  const [closed, setClosed] = useState<'discard' | 'soft' | 'done' | null>(null)
  const timer = useRef<number>(0)

  useEffect(() => {
    setDur(0)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.src = url
    v.onloadedmetadata = () => setDur(v.duration)
  }, [url])

  const { C } = PROTOS[key]
  const reset = () => {
    setEpoch((e) => e + 1)
    setTaps(0)
    setClosed(null)
  }
  const total = useMemo(() => ranges.reduce((n, r) => n + r.end - r.start, 0), [ranges])

  return (
    <div className="p-page">
      <header className="p-head">
        <div className="p-tabs">
          {(Object.keys(PROTOS) as Key[]).map((k) => (
            <button key={k} className={k === key ? 'on' : ''} onClick={() => setQ('proto', k)}>
              {PROTOS[k].name}
            </button>
          ))}
        </div>
        <div className="p-tabs small">
          確認：
          {(['inline', 'sheet', 'undo'] as const).map((m) => (
            <button key={m} className={m === mode ? 'on' : ''} onClick={() => setQ('confirm', m)}>
              {m === 'inline' ? 'カード' : m === 'sheet' ? 'シート' : '出さない'}
            </button>
          ))}
          <label className="p-file">
            動画を選ぶ
            <input
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  setUrl(URL.createObjectURL(f))
                  reset()
                }
              }}
            />
          </label>
        </div>
      </header>
      <div className="p-phone" onPointerDownCapture={() => dur > 0 && setTaps((n) => n + 1)}>
        {dur > 0 && !closed && (
          <C
            key={`${key}-${epoch}-${url}`}
            url={url}
            dur={dur}
            mode={mode}
            onRanges={setRanges}
            onDone={() => setClosed('done')}
            onDiscard={() => setClosed('discard')}
            onSoftClose={() => {
              setClosed('soft')
              window.clearTimeout(timer.current)
              timer.current = window.setTimeout(() => setClosed((c) => (c === 'soft' ? 'discard' : c)), 4000)
            }}
          />
        )}
        {closed && (
          <div className="p-closed">
            <p>{closed === 'done' ? '完了（試作：書き出しはしません）' : '編集画面を閉じました'}</p>
            {closed === 'done' && <p className="p-list">{ranges.map((r) => `${fmt(r.start)}–${fmt(r.end)}`).join('  →  ')}</p>}
            <button className="btn" onClick={reset}>
              最初から試す
            </button>
          </div>
        )}
        {closed === 'soft' && (
          <div className="toast with-action" role="status" style={{ position: 'absolute', bottom: 16 }}>
            <span>変更を破棄しました</span>
            <button
              className="toast-action"
              onClick={() => {
                window.clearTimeout(timer.current)
                setClosed(null)
              }}
            >
              元に戻す
            </button>
          </div>
        )}
        {dur === 0 && <p className="p-closed">読み込み中…</p>}
      </div>
      <aside className="p-side">
        <p>
          <b>操作の回数</b>（指を置いた回数）：{taps}　<button className="p-text" onClick={reset}>最初から</button>
        </p>
        <p>
          <b>できあがり</b>：{fmt(total)}（もとは {fmt(dur)}）
        </p>
        <p className="p-list">{ranges.map((r) => `${fmt(r.start)}–${fmt(r.end)}`).join('  →  ')}</p>
        <p className="p-scenario">
          <b>共通のシナリオ</b>（サンプル動画：①抽出 0–5 秒／②スチーム 5–11 秒／③注ぎ 11–20 秒／④できあがり 20–24 秒）
          <br />1. 頭の 2 秒を切る　2. ②スチームの場面を、まるごと抜く　3. 完了。
          <br />終わったら「操作の回数」を見る。
        </p>
      </aside>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/styles.css'
import './proto.css'
import { fmt } from './model'
import { ProtoR } from './ProtoR'
import type { ConfirmMode, Range, Variant } from './types'

const q = new URLSearchParams(location.search)
const setQ = (k: string, v: string) => {
  const n = new URLSearchParams(location.search)
  n.set(k, v)
  location.search = n.toString()
}
const pick = <T extends string>(k: string, ok: readonly T[], d: T): T => (ok.includes(q.get(k) as T) ? (q.get(k) as T) : d)

const variant: Variant = { split: pick('split', ['under', 'selected'] as const, 'under'), delete: pick('delete', ['ripple', 'gap'] as const, 'ripple') }
const mode: ConfirmMode = pick('confirm', ['sheet', 'undo'] as const, 'sheet')

function Opt({ k, v, label, on }: { k: string; v: string; label: string; on: boolean }) {
  return (
    <button className={on ? 'on' : ''} onClick={() => setQ(k, v)}>
      {label}
    </button>
  )
}

function App() {
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
          分割・頭尻：
          <Opt k="split" v="under" label="再生ヘッドの下" on={variant.split === 'under'} />
          <Opt k="split" v="selected" label="タップで選ぶ" on={variant.split === 'selected'} />
        </div>
        <div className="p-tabs">
          削除：
          <Opt k="delete" v="ripple" label="詰める" on={variant.delete === 'ripple'} />
          <Opt k="delete" v="gap" label="斜線で残す" on={variant.delete === 'gap'} />
          確認：
          <Opt k="confirm" v="sheet" label="シート" on={mode === 'sheet'} />
          <Opt k="confirm" v="undo" label="出さない" on={mode === 'undo'} />
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
          <ProtoR
            key={`${epoch}-${url}`}
            url={url}
            dur={dur}
            mode={mode}
            variant={variant}
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
          <b>操作の回数</b>（指を置いた回数）：{taps}　
          <button className="p-text" onClick={reset}>
            最初から
          </button>
        </p>
        <p>
          <b>できあがり</b>：{fmt(total)}（もとは {fmt(dur)}）
        </p>
        <p className="p-list">{ranges.map((r) => `${fmt(r.start)}–${fmt(r.end)}`).join('  →  ')}</p>
        <p className="p-scenario">
          <b>共通のシナリオ</b>（サンプル 24 秒：①抽出 0–5／②スチーム 5–11／③注ぎ 11–20／④できあがり 20–24）
          <br />1. 頭の 2 秒を切る　2. ②スチームを抜く　3. 尻の 4 秒（④）を切る　4. 完了
          <br />できあがりは、2–5 → 11–20（12 秒）になれば正解。終わったら「操作の回数」を見る。
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

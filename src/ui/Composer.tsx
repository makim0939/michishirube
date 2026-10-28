import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { BUNDLED_BGM, bgmBlob, bgmExtension, bgmTitle, type BgmChoice } from '../data/bgm'
import { composeClips } from '../data/compose'
import { inMemory, probeDuration } from '../data/mediaPrep'
import type { VideoQuality } from '../data/videoStorage'
import {
  hasKept,
  initSegs,
  isUntouched,
  keptRanges,
  moveClip,
  segKey,
  splitAt,
  toggleOff,
  totalSeconds,
  trimEdge,
  MIN_SEG,
  type Doc,
  type Seg,
} from '../domain/clipEdit'
import { BackIcon, ForwardIcon, MusicIcon, PauseIcon, PlayIcon, RedoIcon, ScissorsIcon, SpeakerIcon, TrashIcon, UndoIcon } from './icons'
import { PlusSheet } from './PlusSheet'
import { formatTime, makeFilmstrip } from './Trimmer'
import { useBackHandler } from './useBackHandler'
import { t } from '../i18n'

/** つなぐ動画 1 本。file は、アプリのファイルにある元の動画の場所（あれば、そのまま書き出しに渡す） */
export interface ComposerClip {
  key: string
  blob: Blob
  file?: string
}

/** 動画の長さだけを読み取る（画面には出さない video で、メタデータだけ読む） */
async function blobDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(await inMemory(blob))
  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    return await probeDuration(video)
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/** 帯の絵 1 枚の幅（px） */
const TILE = 34
/** 最初に作る粗い絵の数と、あとから作る細かい絵の数（1 本あたり。取得は、粗い順に全部、そのあと細かく） */
const COARSE = 10
const FINE = 40
/** 拡大の段の倍率（1 秒あたりの px）。ピンチで変える */
const ZOOM_MIN = 24
const ZOOM_MAX = 220
const ZOOM_DEFAULT = 60
/** 再生ヘッドが区間の境目に吸い付く距離（px） */
const SNAP_PX = 7

interface Hist {
  doc: Doc
  past: Doc[]
  future: Doc[]
}

/** 区間の絵を、幅に合わせて並べる。絵は、動画から取った 10〜40 コマのうち、いちばん近いものを使う */
function Tiles({ frames, start, end, duration, width }: { frames?: string[]; start: number; end: number; duration: number; width: number }) {
  const n = Math.max(1, Math.round(width / TILE))
  return (
    <div className="cmp-tiles" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const at = start + ((i + 0.5) / n) * (end - start)
        const f = frames && frames.length > 0 && duration > 0 ? frames[Math.min(frames.length - 1, Math.floor((at / duration) * frames.length))] : undefined
        return f ? <img key={i} src={f} alt="" /> : <span key={i} />
      })}
    </div>
  )
}

/**
 * 動画を仕上げる（iPhone の写真アプリの見た目で、DaVinci Resolve の Cut ページのように操作する）。
 * 2 段のタイムライン：上は全体（なぞると再生ヘッドが動く）、下は再生ヘッドの周りの拡大（再生ヘッドは中央に固定。2 本指で倍率）。
 * 区間をタップして選び、分割・削除（斜線で残す）・戻す。選んだ区間の両端の取っ手でトリム（隣と重ならない）。
 * 取り消し・やり直しが、操作の列にある。キャンセルは確認せず、すぐ閉じる（onDiscard が、トーストの「元に戻す」を出す）。
 * 「完了」で、残す区間を並べた順につなぎ、onDone に渡す（つなぎ目はカットのみ）。作っている間は閉じられない
 */
export function Composer({
  clips: initialClips,
  quality,
  fileName,
  hidden = false,
  mayUsePaid,
  onDone,
  onClose,
  onDiscard,
}: {
  clips: ComposerClip[]
  quality: VideoQuality
  fileName: string
  /** 閉じたあと、トーストの「元に戻す」が押されるまでの間、中身を持ったまま隠す */
  hidden?: boolean
  /** 有料の操作（2 本以上をつなぐ・BGM）をしてよいか。Plus を買っている・無料の回数が残っている間は true */
  mayUsePaid: () => Promise<boolean>
  /** order は、できあがりの並び（clips の key。分割した動画は、同じ key が何度も出る）。paid は、有料の操作を使ったか（無料の回数に数える） */
  onDone: (file: File, order: string[], paid: boolean) => void
  /** 何も変えずに閉じる */
  onClose: () => void
  /** 変えたあとに、キャンセルして閉じる */
  onDiscard: () => void
}) {
  // 開いた時点の動画を使い続ける（親の再描画のたびに、新しい配列が渡されても、長さを読み直さない）
  const [clips] = useState(initialClips)
  const originalOrder = useMemo(() => clips.map((c) => c.key), [clips])
  const clipOf = (key: string) => clips.find((c) => c.key === key)!
  const video = useRef<HTMLVideoElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [hist, setHist] = useState<Hist>({ doc: { order: originalOrder, segs: {} }, past: [], future: [] })
  const doc = hist.doc
  const [durs, setDurs] = useState<Record<string, number>>({})
  /** 選んだ区間（タップで選ぶ。選んでいなければ、再生ヘッドの下の区間） */
  const [sel, setSel] = useState<string>()
  /** 再生ヘッドの位置（つないだ並びの、先頭からの秒） */
  const [g, setG] = useState(0)
  const [curKey, setCurKey] = useState(originalOrder[0])
  const [url, setUrl] = useState<string>()
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [plusSheet, setPlusSheet] = useState(false)
  const [frames, setFrames] = useState<Record<string, string[]>>({})
  const [zoom, setZoom] = useState(ZOOM_DEFAULT)
  const [W, setW] = useState(362)
  /** 元の動画の音を使わない */
  const [muted, setMuted] = useState(false)
  /** 選んだ BGM と音量（0〜1。元の動画の音とは別に決める） */
  const [bgm, setBgm] = useState<BgmChoice>()
  const [bgmVolume, setBgmVolume] = useState(0.3)
  const [bgmListOpen, setBgmListOpen] = useState(false)
  const bgmInput = useRef<HTMLInputElement>(null)
  const bgmVolumeRef = useRef(0.3)
  const bgmAudio = useRef<{ el: HTMLAudioElement; ctx: AudioContext; gain: GainNode } | null>(null)
  /** 読み込み直しのあとに、動かす位置（動画の中の秒）と、続けて再生するか */
  const pendingSeek = useRef<number | null>(null)
  const wantPlay = useRef(false)
  /** 動画ごとの読み込み済みの URL（続けて再生するとき、次の動画をすぐ出すため） */
  const urls = useRef(new Map<string, string>())
  const urlPromises = useRef(new Map<string, Promise<string>>())

  /** 変えたか（キャンセルのとき、すぐ閉じるか、トーストで戻せるようにするか） */
  const dirty = hist.past.length > 0 || !!bgm || muted

  // 履歴に積んで変える。ドラッグ中の細かい更新は、積まない（始めに 1 回だけ積む）
  const commit = (fn: (d: Doc) => Doc, record = true) =>
    setHist((h) => {
      const next = fn(h.doc)
      if (next === h.doc) return h
      return { doc: next, past: record ? [...h.past, h.doc] : h.past, future: record ? [] : h.future }
    })
  const checkpoint = () => setHist((h) => ({ ...h, past: [...h.past, h.doc], future: [] }))
  const undo = () => setHist((h) => (h.past.length ? { doc: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.doc, ...h.future] } : h))
  const redo = () => setHist((h) => (h.future.length ? { doc: h.future[0], past: [...h.past, h.doc], future: h.future.slice(1) } : h))

  // ---- 並びの形（動画の長さが分かったものから） ----
  const lay = useMemo(() => {
    let off = 0
    return doc.order.map((key) => {
      const d = durs[key] ?? 0
      const c = { key, off, d, segs: doc.segs[key] ?? [] }
      off += d
      return c
    })
  }, [doc, durs])
  const T = lay.reduce((n, c) => n + c.d, 0)
  const ready = clips.every((c) => (durs[c.key] ?? 0) > 0) && lay.every((c) => c.segs.length > 0)
  const ranges = useMemo(() => keptRanges(doc, durs), [doc, durs])
  const total = totalSeconds(ranges)
  const paid = ranges.length > 1 || !!bgm
  const needsCompose = paid || muted || !isUntouched(ranges, originalOrder, durs)

  const locate = (gg: number) => {
    const c = lay.find((x) => gg >= x.off && gg < x.off + x.d) ?? lay[lay.length - 1]
    return { c, local: Math.min(c.d, Math.max(0, gg - c.off)) }
  }
  const segAtG = (gg: number): Seg | undefined => {
    const { c, local } = locate(gg)
    return c?.segs.find((s) => local >= s.start && local < s.end) ?? c?.segs[c.segs.length - 1]
  }
  const under = ready ? segAtG(g) : undefined
  const allSegs = lay.flatMap((c) => c.segs)
  const target = (sel ? allSegs.find((s) => s.id === sel) : undefined) ?? under
  const targetClip = target ? lay.find((c) => c.key === segKey(target.id)) : undefined

  // 全部の動画の長さを読み取り、区間を初期化する（頭から尻まで、ひとつの残す区間）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const c of clips) {
        try {
          const d = await blobDuration(c.blob)
          if (cancelled) return
          setDurs((p) => ({ ...p, [c.key]: d }))
          setHist((h) => (h.doc.segs[c.key] ? h : { ...h, doc: { ...h.doc, segs: { ...h.doc.segs, [c.key]: initSegs(c.key, d) } } }))
        } catch {
          if (!cancelled) setError(t.editor.durationFailed)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clips])

  useEffect(() => {
    const measure = () => root.current && setW(Math.max(200, root.current.clientWidth - 28))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  /** 動画を、メモリに写して再生できるようにした URL（iPhone で IndexedDB の動画を直接再生できないことがあるため）。
   * 一度写したものは取っておく（続けて再生するとき、帯の絵を作るとき、すぐ使えるように）。画面を閉じるときにまとめて解放する */
  const urlFor = (key: string): Promise<string> => {
    let p = urlPromises.current.get(key)
    if (!p) {
      p = inMemory(clipOf(key).blob).then((b) => {
        const u = URL.createObjectURL(b)
        urls.current.set(key, u)
        return u
      })
      urlPromises.current.set(key, p)
    }
    return p
  }

  // プレビューの動画を、再生できるようにする
  useEffect(() => {
    let cancelled = false
    const cached = urls.current.get(curKey)
    if (cached) {
      setUrl(cached)
      return
    }
    setUrl(undefined)
    urlFor(curKey)
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch(() => setError(t.common.videoLoadFailed))
    return () => {
      cancelled = true
    }
    // urlFor は clips から引くだけなので、動画が変わったときだけ読み直す
  }, [curKey])

  useEffect(() => {
    const promises = urlPromises.current
    const cache = urls.current
    return () => {
      for (const p of promises.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => {})
      promises.clear()
      cache.clear()
    }
  }, [])

  // 帯の絵：まず全部の動画の粗い絵（すぐ見えるように）、そのあと細かい絵（短い区間も、絵で見分けられるように）
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void (async () => {
      for (const n of [COARSE, FINE]) {
        for (const key of originalOrder) {
          try {
            const u = await urlFor(key)
            // 粗い絵は、キーフレームへ飛んで速く作る（すぐ見えるように）。細かい絵は、正確な位置で作る
            const list = await makeFilmstrip(u, durs[key], n, () => cancelled, n === COARSE)
            if (cancelled) return
            if (list.length === n) setFrames((p) => ({ ...p, [key]: list }))
          } catch {
            // 絵が作れなくても、区間の枠と長さで操作できる
          }
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // 長さが全部分かったとき（区間が増えても、作り直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // BGM を、画面で聞けるようにする（iPhone は audio 要素の音量を変えられないので、GainNode で音量を決める）
  useEffect(() => {
    if (!bgm) return
    let cancelled = false
    let objectUrl: string | undefined
    void bgmBlob(bgm)
      .then((b) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(b)
        const el = new Audio(objectUrl)
        el.loop = true
        const ctx = new AudioContext()
        const gain = ctx.createGain()
        gain.gain.value = bgmVolumeRef.current
        ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination)
        bgmAudio.current = { el, ctx, gain }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      const a = bgmAudio.current
      bgmAudio.current = null
      if (a) {
        a.el.pause()
        void a.ctx.close().catch(() => {})
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [bgm])

  useEffect(() => {
    bgmVolumeRef.current = bgmVolume
    if (bgmAudio.current) bgmAudio.current.gain.gain.value = bgmVolume
  }, [bgmVolume])

  useEffect(() => {
    if (video.current) video.current.muted = muted
  }, [muted])

  // ---- 再生 ----
  // 描画のたびに最新の値を入れておく（再生中の細かい確認が、古い値を見ないように）
  const L = useRef({ lay, curKey, seekGlobal: (_gg: number, _play: boolean) => {}, stopAll: () => {} })

  /** 再生ヘッドを動かす。別の動画なら、その動画を読み込み直す（読み込んだら、動かして、続けて再生する） */
  function seekGlobal(gg: number, play: boolean) {
    const { c, local } = locate(Math.min(Math.max(0, gg), Math.max(0, T - 0.001)))
    if (!c) return
    setG(c.off + local)
    wantPlay.current = play
    if (c.key !== curKey) {
      pendingSeek.current = local
      setCurKey(c.key)
      return
    }
    const v = video.current
    if (!v) return
    v.currentTime = local
    if (play) void v.play().catch(() => {})
  }

  /** 再生を止める（BGM も） */
  function stopAll() {
    video.current?.pause()
    bgmAudio.current?.el.pause()
    wantPlay.current = false
  }
  L.current = { lay, curKey, seekGlobal, stopAll }

  // 動画を設定したら、決めた位置へ動かす。iPhone は、タップするまで動画のデータを読み込まず（loadeddata も来ない）、最初のコマが出ないので、
  // 音なしで一度再生して、コマを出す。続けて再生するときは、そのまま再生を続ける
  useEffect(() => {
    const v = video.current
    if (!v || !url) return
    let cancelled = false
    void (async () => {
      const keep = wantPlay.current
      v.muted = true
      await v.play().catch(() => {})
      if (cancelled) return
      const at = pendingSeek.current ?? 0
      pendingSeek.current = null
      if (!keep) v.pause()
      v.currentTime = at
      v.muted = muted
    })()
    return () => {
      cancelled = true
    }
    // 動画を読み込み直したときだけ（再生・音の切り替えのたびには、やり直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  /** 再生中の確認：外した区間・動画の終わりに来たら、次に残る区間へ（別の動画なら、そちらへ）。なければ止める */
  const checkPlay = () => {
    const v = video.current
    const { lay: ls, curKey: ck } = L.current
    if (!v || v.paused) return
    const ci = ls.findIndex((c) => c.key === ck)
    const c = ls[ci]
    if (!c || v.seeking) return
    const local = v.currentTime
    setG(c.off + local)
    const seg = c.segs.find((s) => local >= s.start && local < s.end)
    const atEnd = local >= c.d - 0.04
    if (seg && !seg.off && !atEnd) return
    const next = atEnd ? undefined : c.segs.find((s) => !s.off && s.start >= (seg?.end ?? c.d) - 1e-6)
    if (next) {
      v.currentTime = next.start
      return
    }
    for (let j = ci + 1; j < ls.length; j++) {
      const n = ls[j].segs.find((s) => !s.off)
      if (n) {
        L.current.seekGlobal(ls[j].off + n.start, true)
        return
      }
    }
    L.current.stopAll()
  }

  useEffect(() => {
    if (!playing) return
    let id = requestAnimationFrame(function tick() {
      checkPlay()
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
  }, [playing])

  /** 再生ヘッドの位置から、残す区間の中へ（外した区間・動画の終わりなら、次に残る区間の頭へ）。なければ最初の残す区間 */
  const snapToKept = (gg: number): number | undefined => {
    const all = lay.flatMap((c) => c.segs.filter((s) => !s.off).map((s) => ({ at: c.off + s.start, to: c.off + s.end })))
    if (all.some((x) => gg >= x.at && gg < x.to - 0.05)) return gg
    return all.find((x) => x.at >= gg)?.at ?? all[0]?.at
  }

  /** 位置より前に、残す区間がどれだけあるか（BGM を、つないだときと同じ位置から流すため） */
  const keptBefore = (gg: number) => {
    let sum = 0
    for (const c of lay) for (const s of c.segs) if (!s.off) sum += Math.max(0, Math.min(c.off + s.end, gg) - (c.off + s.start))
    return sum
  }

  const togglePlay = () => {
    if (!ready || busy) return
    if (playing) {
      stopAll()
      return
    }
    const at = snapToKept(g)
    if (at === undefined) return
    seekGlobal(at, true)
    const a = bgmAudio.current
    if (a) {
      if (a.ctx.state === 'suspended') void a.ctx.resume()
      a.el.currentTime = a.el.duration > 0 && Number.isFinite(a.el.duration) ? keptBefore(at) % a.el.duration : 0
      void a.el.play().catch(() => {})
    }
  }

  // 隠したら（キャンセルして、トーストが出ている間）、再生を止める
  useEffect(() => {
    if (hidden) stopAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden])

  // ---- タイムライン ----
  /** 上の段は、両端の取っ手（フィルムの外に出る）が画面の端で欠けたり、端のジェスチャーと重ならないよう、少し内側に置く */
  const ovW = W - 20
  const pxs1 = ovW / Math.max(T, 0.1)
  const snap = (gg: number, pxs: number) => {
    for (const c of lay) for (const s of c.segs.slice(1)) if (Math.abs(c.off + s.start - gg) * pxs < SNAP_PX) return c.off + s.start
    return gg
  }
  const scrubTo = (gg: number, pxs: number) => {
    stopAll()
    seekGlobal(Math.min(T - 0.001, Math.max(0, snap(gg, pxs))), false)
  }
  const selectAt = (gg: number) => setSel(segAtG(Math.min(T - 0.001, Math.max(0, gg)))?.id)

  const ov = useRef<HTMLDivElement>(null)
  const ovAt = (e: PointerEvent) => {
    const r = ov.current!.getBoundingClientRect()
    return ((e.clientX - r.left) / r.width) * T
  }
  const ovDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const gg = ovAt(e)
    scrubTo(gg, pxs1)
    selectAt(gg)
  }

  // 下の段：再生ヘッドは中央に固定、なぞると流れる。2 本指で倍率
  const pts = useRef(new Map<number, number>())
  const cu = useRef<{ x0: number; g0: number; dist0: number; z0: number } | null>(null)
  const cuDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pts.current.set(e.pointerId, e.clientX)
    const xs = [...pts.current.values()]
    cu.current = { x0: e.clientX, g0: g, dist0: xs.length === 2 ? Math.abs(xs[0] - xs[1]) : 0, z0: zoom }
    stopAll()
    if (xs.length === 1) {
      const rect = e.currentTarget.getBoundingClientRect()
      selectAt(g + (e.clientX - rect.left - W / 2) / zoom)
    }
  }
  const cuMove = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !cu.current) return
    pts.current.set(e.pointerId, e.clientX)
    const xs = [...pts.current.values()]
    if (xs.length === 2) {
      const d = Math.abs(xs[0] - xs[1])
      if (cu.current.dist0 > 0) setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (cu.current.z0 * d) / cu.current.dist0)))
      else cu.current.dist0 = d
      return
    }
    scrubTo(cu.current.g0 - (e.clientX - cu.current.x0) / zoom, zoom)
  }
  const cuUp = (e: PointerEvent) => {
    pts.current.delete(e.pointerId)
    cu.current = null
  }

  // ---- 区間の端（取っ手）を引く ----
  const hd = useRef<{ id: string; edge: 'start' | 'end'; x0: number; t0: number; pxs: number } | null>(null)
  const handleDown = (edge: 'start' | 'end', pxs: number) => (e: PointerEvent) => {
    if (!target) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    stopAll()
    checkpoint()
    hd.current = { id: target.id, edge, x0: e.clientX, t0: target[edge], pxs }
  }
  const handleMove = (e: PointerEvent) => {
    const d = hd.current
    if (!d || !targetClip) return
    e.stopPropagation()
    const key = segKey(d.id)
    const t = Math.min(targetClip.d, Math.max(0, d.t0 + (e.clientX - d.x0) / d.pxs))
    commit((doc0) => ({ ...doc0, segs: { ...doc0.segs, [key]: trimEdge(doc0.segs[key], key, d.id, d.edge, t, durs[key]) } }), false)
    seekGlobal(targetClip.off + Math.min(targetClip.d - 0.01, t), false)
  }
  const handleUp = () => {
    hd.current = null
  }

  // ---- 操作 ----
  const inTarget = !!target && !!targetClip && g - targetClip.off - target.start >= MIN_SEG && targetClip.off + target.end - g >= MIN_SEG
  const canSplit = ready && !busy && inTarget
  /** 外せるのは、残す区間が 1 つ以上残るとき（ぜんぶ外すと、できあがりが空になる） */
  const canDelete = (() => {
    if (!ready || busy || !target) return false
    if (target.off) return true
    const key = segKey(target.id)
    return hasKept({ ...doc, segs: { ...doc.segs, [key]: toggleOff(doc.segs[key], target.id) } })
  })()
  const split = () => {
    if (!target || !canSplit) return
    stopAll()
    const key = segKey(target.id)
    const at = g - targetClip!.off
    commit((d) => ({ ...d, segs: { ...d.segs, [key]: splitAt(d.segs[key], key, at) } }))
  }
  const remove = () => {
    if (!target || !canDelete) return
    stopAll()
    const key = segKey(target.id)
    commit((d) => ({ ...d, segs: { ...d.segs, [key]: toggleOff(d.segs[key], target.id) } }))
    setSel(undefined)
  }
  const move = (delta: -1 | 1) => {
    if (!target) return
    stopAll()
    commit((d) => ({ ...d, order: moveClip(d.order, segKey(target.id), delta) }))
  }
  const orderIndex = target ? doc.order.indexOf(segKey(target.id)) : -1

  const done = async () => {
    if (!ready || busy) return
    if (!needsCompose) {
      onClose()
      return
    }
    if (ranges.length === 0) return
    stopAll()
    setError(undefined)
    setBusy(true)
    try {
      // 無料で試せる回数を使い切っていたら、書き出す前に購入の案内（画面を見て、触れたうえで判断してもらう）
      if (paid && !(await mayUsePaid())) {
        setPlusSheet(true)
        return
      }
      const file = await composeClips(
        ranges.map((r) => {
          const c = clipOf(r.key)
          return {
            source: c.file ? { file: c.file } : { blob: c.blob },
            start: r.start,
            // 動画の終わりまで使うときは end を送らない（長さの誤差で、終わりを超えないように）
            ...(r.end >= r.duration - 0.05 ? {} : { end: r.end }),
            duration: r.duration,
          }
        }),
        quality,
        fileName,
        bgm ? { source: { blob: await bgmBlob(bgm) }, volume: bgmVolume, extension: bgmExtension(bgm) } : undefined,
        muted,
      )
      onDone(
        file,
        ranges.map((r) => r.key),
        paid,
      )
    } catch (e) {
      setError(e instanceof Error ? t.compose.failedWith(e.message) : t.compose.failed)
    } finally {
      setBusy(false)
    }
  }

  /** キャンセル：変えていなければ、そのまま閉じる。変えていれば、確認せず閉じ、親が「元に戻す」のトーストを出す（作っている間は閉じない） */
  const cancel = () => {
    if (busy) return
    if (dirty) onDiscard()
    else onClose()
  }
  useBackHandler(() => {
    if (hidden) return false
    cancel()
    return true
  })

  // ---- 帯の描き方 ----
  const frame = (pxs: number) => {
    if (!target || !targetClip) return null
    return (
      <div className="filmstrip-frame" style={{ left: (targetClip.off + target.start) * pxs, width: Math.max(2, (target.end - target.start) * pxs) }}>
        <span
          className="filmstrip-handle cmp-handle start"
          role="slider"
          aria-label={t.editor.start}
          aria-valuenow={target.start}
          onPointerDown={handleDown('start', pxs)}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        />
        <span
          className="filmstrip-handle cmp-handle end"
          role="slider"
          aria-label={t.editor.end}
          aria-valuenow={target.end}
          onPointerDown={handleDown('end', pxs)}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        />
      </div>
    )
  }
  const track = (pxs: number) =>
    lay.flatMap((c) =>
      c.segs.map((s, i) => (
        <div
          key={s.id}
          className={`cmp-seg${s.off ? ' off' : ''}${i === 0 && c.off > 0 ? ' first' : ''}`}
          style={{ left: (c.off + s.start) * pxs, width: (s.end - s.start) * pxs }}
        >
          <Tiles frames={frames[c.key]} start={s.start} end={s.end} duration={c.d} width={(s.end - s.start) * pxs} />
        </div>
      )),
    )

  const delLabel = target?.off ? t.compose.restore : t.compose.remove

  return (
    <div
      ref={root}
      className="recorder editor cmp"
      role="dialog"
      aria-modal="true"
      aria-label={t.compose.title}
      style={hidden ? { display: 'none' } : undefined}
    >
      <div className="editor-top">
        <button className="editor-text-button" onClick={cancel} disabled={busy}>
          {t.editor.cancel}
        </button>
        <span className="editor-title">{ready ? formatTime(total) : ''}</span>
        <button className="editor-text-button primary" onClick={() => void done()} disabled={!ready || busy}>
          {t.compose.done}
        </button>
      </div>

      <div className="editor-stage">
        <video
          ref={video}
          className="editor-video"
          src={url}
          playsInline
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={busy ? undefined : togglePlay}
        />
        {ready && !playing && !busy && (
          <button className="editor-play" aria-label={t.player.play} onClick={togglePlay}>
            <PlayIcon size={30} />
          </button>
        )}
      </div>

      <div className="editor-panel">
        {error && <p className="trimmer-error">{error}</p>}
        {!ready && !error && <p className="editor-status">{t.editor.loading}</p>}
        {busy && (
          <div className="editor-progress">
            <p>{t.compose.working}</p>
            <div className="progress indeterminate" aria-hidden="true">
              <span />
            </div>
          </div>
        )}

        {ready && !busy && (
          <>
            {/* 音：元の音のあり・なし（スピーカー 1 つ）。BGM は、同梱の曲が入るまでは出さない（曲の持ち合わせがない人には使えないため） */}
            <div className="cmp-sound">
              <button
                type="button"
                className={`editor-sound${muted ? ' off' : ''}`}
                aria-pressed={muted}
                aria-label={muted ? t.editor.mutedLabel : t.editor.soundLabel}
                onClick={() => setMuted((m) => !m)}
              >
                <SpeakerIcon size={22} off={muted} />
              </button>
              {BUNDLED_BGM.length > 0 && (
                <>
                  <button type="button" className="editor-text-button bgm-button" onClick={() => setBgmListOpen((o) => !o)}>
                    <MusicIcon size={18} />
                    {bgm ? bgmTitle(bgm) : t.compose.bgm}
                  </button>
                  {bgm && (
                    <>
                      <input
                        type="range"
                        className="bgm-volume"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={bgmVolume}
                        aria-label={t.compose.bgmVolume}
                        onChange={(e) => setBgmVolume(Number(e.target.value))}
                      />
                      <button type="button" className="editor-text-button" onClick={() => setBgm(undefined)}>
                        {t.compose.bgmOff}
                      </button>
                    </>
                  )}
                  <input
                    ref={bgmInput}
                    hidden
                    type="file"
                    accept="audio/*,.m4a,.mp3,.wav,.aac"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) setBgm({ kind: 'file', file })
                      e.target.value = ''
                    }}
                  />
                </>
              )}
            </div>
            {BUNDLED_BGM.length > 0 && bgmListOpen && (
              <ul className="bgm-list">
                {BUNDLED_BGM.map((track0) => (
                  <li key={track0.id}>
                    <button
                      type="button"
                      className="editor-text-button"
                      onClick={() => {
                        setBgm({ kind: 'bundled', track: track0 })
                        setBgmListOpen(false)
                      }}
                    >
                      {track0.title}
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" className="editor-text-button" onClick={() => bgmInput.current?.click()}>
                    {t.compose.bgmFile}
                  </button>
                </li>
              </ul>
            )}

            {/* 上の段：全体（なぞると、再生ヘッドが動く） */}
            <div className="cmp-ov">
              <div className="cmp-ov-in" ref={ov} style={{ width: ovW }} onPointerDown={ovDown} onPointerMove={(e) => e.buttons && !hd.current && scrubTo(ovAt(e), pxs1)}>
                {track(pxs1)}
                {frame(pxs1)}
                <div className="filmstrip-head" style={{ left: g * pxs1 }} aria-hidden="true" />
              </div>
            </div>

            {/* 下の段：再生ヘッドの周りの拡大（再生ヘッドは中央に固定。2 本指で倍率） */}
            <div className="cmp-cu" onPointerDown={cuDown} onPointerMove={cuMove} onPointerUp={cuUp} onPointerCancel={cuUp}>
              <div className="cmp-cu-in" style={{ width: T * zoom, transform: `translateX(${W / 2 - g * zoom}px)` }}>
                {track(zoom)}
                {frame(zoom)}
              </div>
              <div className="filmstrip-head" style={{ left: W / 2 }} aria-hidden="true" />
            </div>

            {/* 操作：よく使う順 */}
            <div className="cmp-tools">
              <button className="cmp-tool" aria-label={playing ? t.player.pause : t.player.play} onClick={togglePlay}>
                {playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
              </button>
              <button className="cmp-tool" aria-label={t.compose.split} disabled={!canSplit} onClick={split}>
                <ScissorsIcon size={24} />
                <span>{t.compose.split}</span>
              </button>
              <button className="cmp-tool" aria-label={delLabel} disabled={!canDelete} onClick={remove}>
                <TrashIcon size={24} />
                <span>{delLabel}</span>
              </button>
              <button className="cmp-tool" aria-label={t.compose.undo} disabled={hist.past.length === 0} onClick={undo}>
                <UndoIcon size={24} />
                <span>{t.compose.undo}</span>
              </button>
              <button className="cmp-tool" aria-label={t.compose.redo} disabled={hist.future.length === 0} onClick={redo}>
                <RedoIcon size={24} />
                <span>{t.compose.redo}</span>
              </button>
              {doc.order.length > 1 && (
                <>
                  <button className="cmp-tool" aria-label={t.compose.earlier} disabled={orderIndex <= 0} onClick={() => move(-1)}>
                    <BackIcon size={24} />
                    <span>{t.compose.earlier}</span>
                  </button>
                  <button className="cmp-tool" aria-label={t.compose.later} disabled={orderIndex < 0 || orderIndex >= doc.order.length - 1} onClick={() => move(1)}>
                    <ForwardIcon size={24} />
                    <span>{t.compose.later}</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {plusSheet && (
        <PlusSheet
          onUnlocked={() => {
            setPlusSheet(false)
            void done()
          }}
          onClose={() => setPlusSheet(false)}
        />
      )}
    </div>
  )
}

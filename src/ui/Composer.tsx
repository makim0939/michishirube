import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { BgmPlayer } from '../data/bgmPlayer'
import { BgmSheet } from './BgmSheet'
import { BUNDLED_BGM, bgmBlob, bgmExtension, bgmTitle, type BgmChoice } from '../data/bgm'
import { composeClips } from '../data/compose'
import { cancelComposeVideoFiles, ComposeCancelled } from '../data/files'
import { inMemory, probeDuration, QUALITY } from '../data/mediaPrep'
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
import { ChevronDownIcon, BackIcon, ForwardIcon, MusicIcon, PauseIcon, PlayIcon, RedoIcon, ScissorsIcon, SpeakerIcon, TextIcon, TrashIcon, UndoIcon } from './icons'
import {
  applyStyle,
  currentStyle,
  drawText,
  fitAll,
  fitFrom,
  fitTo,
  lanes as textLanes,
  loadTextFonts,
  moveEnd,
  moveStart,
  newText,
  snapCenter,
  TEXT_COLORS,
  TEXT_FONTS,
  TEXT_STYLES,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  type TextBox,
  type TextOverlay,
} from '../domain/textOverlay'
import { PlusSheet } from './PlusSheet'
import { renderTextOverlays } from './textRender'
import { formatTime, makeFilmstrip } from './Trimmer'
import { DIAG_HOLD_MS, VideoDiag, diagLog, diagPlayRejected, type DiagInfo } from './VideoDiag'
import { useBackHandler } from './useBackHandler'
import { t } from '../i18n'

/** つなぐ動画 1 本。file は、アプリのファイルにある元の動画の場所（あれば、そのまま書き出しに渡す） */
export interface ComposerClip {
  key: string
  /** メモリ上の動画。src があれば、無くてよい */
  blob?: Blob
  /** アプリのファイルの URL（iPhone）。あれば、メモリに写さずに、再生・長さ・帯の絵に使う */
  src?: string
  file?: string
}

/** 動画の長さと絵の大きさ（向きを直したあと）を読み取る（画面には出さない video で、メタデータだけ読む） */
async function urlDuration(url: string): Promise<{ duration: number; w: number; h: number }> {
  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    const duration = await probeDuration(video)
    return { duration, w: video.videoWidth, h: video.videoHeight }
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}

/** 色の選び：はじめの 5 色と、システムのカラーピッカー（どんな色でも）。選んでいる色が 5 色に無ければ、ピッカーの丸にその色を出す */
function Swatches({
  small = false,
  value,
  label,
  custom,
  onPick,
  onPicker,
  onPickerOpen,
}: {
  small?: boolean
  value: string
  label: readonly string[]
  custom: string
  onPick: (c: string) => void
  onPicker: (c: string) => void
  onPickerOpen: () => void
}) {
  const preset = (TEXT_COLORS as readonly string[]).includes(value)
  return (
    <div className={`cmp-swatches${small ? ' small' : ''}`} role="group">
      {TEXT_COLORS.map((col, i) => (
        <button key={col} type="button" className={`cmp-swatch${value === col ? ' on' : ''}`} style={{ background: col }} aria-label={label[i]} aria-pressed={value === col} onClick={() => onPick(col)} />
      ))}
      <label className={`cmp-swatch custom${preset ? '' : ' on'}`} style={preset ? undefined : { background: value }} aria-label={custom}>
        <input type="color" value={value} onFocus={onPickerOpen} onChange={(e) => onPicker(e.target.value)} />
      </label>
    </div>
  )
}

/** 指を捉える（画面の外へ出ても、追い続けるため）。捉えられない指（合成された操作など）でも、止まらない */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id)
  } catch {
    // 捉えられなくても、操作は続ける
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
/** テキストの時間の帯 1 段の高さ（px） */
const LANE = 22
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
 * 動画を編集する（iPhone の写真アプリの見た目で、DaVinci Resolve の Cut ページのように操作する）。
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
  const [hist, setHist] = useState<Hist>({ doc: { order: originalOrder, segs: {}, texts: [] }, past: [], future: [] })
  const doc = hist.doc
  const [durs, setDurs] = useState<Record<string, number>>({})
  /** 動画ごとの絵の大きさ（テキストを置く・書き出すときの比） */
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({})
  const stage = useRef<HTMLDivElement>(null)
  const textCanvas = useRef<HTMLCanvasElement>(null)
  /** 絵（動画の見えている部分）の、舞台の中での位置と大きさ（px） */
  const [vr, setVr] = useState<{ x: number; y: number; w: number; h: number }>()
  /** 選んだテキストと、文字を入力しているか */
  const [selText, setSelText] = useState<string>()
  const [editing, setEditing] = useState(false)
  const textInput = useRef<HTMLTextAreaElement>(null)
  /** 置いたばかりで、まだ何も打っていない（空のまま閉じたら、置く前に戻す） */
  const freshText = useRef(false)
  /** 文字を打っている間だけ true（キーボードを閉じたときと「決定」で、2 回終わらせないため） */
  const editingRef = useRef(false)
  /** いま描いているテキストの外枠（画面の px）。つかむ・選ぶ範囲の判定に使う */
  const textBoxes = useRef<{ id: string; box: TextBox }[]>([])
  /** 選んだテキストの、設定の種類（フォント・文字の色・背景・大きさ）。続けて使えるよう、前回の種類を覚えておく */
  const [styleTab, setStyleTab] = useState<'font' | 'style' | 'color' | 'time'>('style')
  /** 同梱のフォントを読み終えたら、描き直す */
  const [fontTick, setFontTick] = useState(0)
  /** カラーピッカーを開いている間の、取り消しの 1 手（開くたびに 1 回だけ積む） */
  const pickerRecorded = useRef(false)
  /** 選んだ区間（タップで選ぶ。選んでいなければ、再生ヘッドの下の区間） */
  const [sel, setSel] = useState<string>()
  /** 再生ヘッドの位置（つないだ並びの、先頭からの秒） */
  const [g, setG] = useState(0)
  /**
   * 端（取っ手）・帯を引いている間、下の段を止めておく位置（動画の中の秒）。
   * 引くたびに再生ヘッドも動くので、止めないと、下の段が指と同じ向きに流れて、引いている端が、中央から動かなくなる
   * （指を動かしても、端が追ってこない）。止めている間は、再生ヘッドの線が、端といっしょに動く
   */
  const [freezeG, setFreezeG] = useState<number | null>(null)
  /** 引き終わったあと、下の段を中央へ戻す間だけ、滑らかに動かす */
  const [settling, setSettling] = useState(false)
  const viewG = freezeG ?? g
  const freezeView = () => {
    setSettling(false)
    setFreezeG(g)
  }
  const releaseView = () => {
    setFreezeG(null)
    setSettling(true)
    window.setTimeout(() => setSettling(false), 220)
  }
  const [curKey, setCurKey] = useState(originalOrder[0])
  const [url, setUrl] = useState<string>()
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 書き出しの進み（0〜1）。0 のあいだは、流れる線を出す */
  const [progress, setProgress] = useState(0)
  /** 作っている間に「キャンセル」を押された（ネイティブが始まる前でも、始めないようにする） */
  const cancelRequested = useRef(false)
  const [error, setError] = useState<string>()
  /** 映像が止まる不具合を調べる診断を、出しているか（時間表示の長押しで出し入れ。保存しない） */
  const [diag, setDiag] = useState(false)
  const diagHold = useRef<number | undefined>(undefined)
  /** 帯の絵づくりが動いているか（診断に出すだけ） */
  const filmBusy = useRef(false)
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
  /** 曲を選んだ直後に、再生して聴かせるか（曲を読み込み終えたとき） */
  const previewNext = useRef(false)
  const previewRef = useRef<() => void>(() => {})
  const bgmVolumeRef = useRef(0.3)
  const bgmAudio = useRef<BgmPlayer | null>(null)
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
  const hasText = doc.texts.some((o) => o.text.trim())
  const paid = ranges.length > 1 || !!bgm || hasText
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
  const texts = doc.texts
  const selT = selText ? texts.find((o) => o.id === selText) : undefined

  // 全部の動画の長さを読み取り、区間を初期化する（頭から尻まで、ひとつの残す区間）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const c of clips) {
        try {
          const { duration: d, w, h } = await urlDuration(await urlFor(c.key))
          if (cancelled) return
          setDurs((p) => ({ ...p, [c.key]: d }))
          setSizes((p) => ({ ...p, [c.key]: { w, h } }))
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
      const c = clipOf(key)
      p = (c.src ? Promise.resolve(c.src) : inMemory(c.blob!).then((b) => URL.createObjectURL(b))).then((u) => {
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
      // ファイルの URL（src）は、解放するものではない
      for (const p of promises.values()) void p.then((u) => u.startsWith('blob:') && URL.revokeObjectURL(u)).catch(() => {})
      promises.clear()
      cache.clear()
    }
  }, [])

  // 帯の絵：まず全部の動画の粗い絵（すぐ見えるように）、そのあと細かい絵（短い区間も、絵で見分けられるように）
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void (async () => {
      filmBusy.current = true
      diagLog('帯の絵づくり 開始')
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
      filmBusy.current = false
      diagLog('帯の絵づくり 終わり')
    })()
    return () => {
      cancelled = true
      filmBusy.current = false
    }
    // 長さが全部分かったとき（区間が増えても、作り直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // BGM を、画面で聞けるようにする（継ぎ目の無い繰り返しと、iPhone での音量の変更は BgmPlayer）
  useEffect(() => {
    if (!bgm) return
    let cancelled = false
    let player: BgmPlayer | undefined
    const loadStart = performance.now()
    diagLog('BGM 読み込み 開始')
    void BgmPlayer.create(bgm, bgmVolumeRef.current)
      .then((p) => {
        diagLog(`BGM 読み込み 終わり ${Math.round(performance.now() - loadStart)}ms`)
        if (cancelled) {
          p.dispose()
          return
        }
        player = p
        bgmAudio.current = p
        // 選んだ曲は、その場で聴けるように、続けて再生する（映像も、BGM といっしょに流れる）
        if (previewNext.current) {
          previewNext.current = false
          previewRef.current()
        }
      })
      .catch((e) => diagLog(`BGM 読み込み 失敗 ${e instanceof Error ? e.name : e}`))
    return () => {
      cancelled = true
      if (bgmAudio.current === player) bgmAudio.current = null
      player?.dispose()
    }
  }, [bgm])

  useEffect(() => {
    bgmVolumeRef.current = bgmVolume
    bgmAudio.current?.setVolume(bgmVolume)
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
    if (play) void v.play().catch(diagPlayRejected)
  }

  /** 再生を止める（BGM も） */
  function stopAll() {
    video.current?.pause()
    bgmAudio.current?.pause()
    wantPlay.current = false
  }
  L.current = { lay, curKey, seekGlobal, stopAll }

  // 動画を設定したら、決めた位置へ動かす。iPhone は、タップするまで動画のデータを読み込まず（loadeddata も来ない）、最初のコマが出ないので、
  // 音なしで一度再生して、コマを出す。続けて再生するときは、そのまま再生を続ける。
  // コマが出るまでの間（端末や動画によっては 1 秒ほどかかる）に、利用者が再生を押すことがある。再生するかは、始める前ではなく、
  // 終わったときに読み直す（始める前の値で止めると、押した再生を取り消して、位置も 0 に戻してしまう）
  useEffect(() => {
    const v = video.current
    if (!v || !url) return
    let cancelled = false
    void (async () => {
      v.muted = true
      await v.play().catch((e) => diagLog(`コマ出しの play() 拒否 ${e instanceof Error ? e.name : e}`))
      if (cancelled) return
      const at = pendingSeek.current
      pendingSeek.current = null
      if (!wantPlay.current) v.pause()
      // 押された再生は、押した位置のまま続ける。止まっているときと、別の動画へ切り替えたときだけ、位置を決める
      if (!wantPlay.current || at !== null) v.currentTime = at ?? 0
      v.muted = muted
      // コマ出しの再生が、押された再生を中断していたら、始め直す
      if (wantPlay.current && v.paused) void v.play().catch(diagPlayRejected)
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
    // 別の動画を読み込み中は、確認しない（前の動画の位置を見てしまうため）
    if (!c || v.seeking || pendingSeek.current !== null) return
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

  /** BGM の一覧を開く（流れている映像と曲は止める。一覧の試聴と重ならないように） */
  const openBgmSheet = () => {
    stopAll()
    setBgmListOpen(true)
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
    bgmAudio.current?.play(keptBefore(at))
  }

  // 曲を選んだとき：止まっていれば、再生を始める。もう再生中なら、BGM だけ、その位置から流す
  previewRef.current = () => {
    if (!playing) {
      togglePlay()
      return
    }
    bgmAudio.current?.play(keptBefore(g))
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
  const selectAt = (gg: number) => {
    setSel(segAtG(Math.min(T - 0.001, Math.max(0, gg)))?.id)
    setSelText(undefined)
  }

  const ov = useRef<HTMLDivElement>(null)
  const ovAt = (e: PointerEvent) => {
    const r = ov.current!.getBoundingClientRect()
    return ((e.clientX - r.left) / r.width) * T
  }
  const ovDown = (e: PointerEvent) => {
    capture(e.currentTarget, e.pointerId)
    const gg = ovAt(e)
    scrubTo(gg, pxs1)
    selectAt(gg)
  }

  // 下の段：再生ヘッドは中央に固定、なぞると流れる。2 本指で倍率
  const pts = useRef(new Map<number, number>())
  const cu = useRef<{ x0: number; g0: number; dist0: number; z0: number } | null>(null)
  const cuDown = (e: PointerEvent) => {
    capture(e.currentTarget, e.pointerId)
    pts.current.set(e.pointerId, e.clientX)
    const xs = [...pts.current.values()]
    cu.current = { x0: e.clientX, g0: g, dist0: xs.length === 2 ? Math.abs(xs[0] - xs[1]) : 0, z0: zoom }
    stopAll()
    if (xs.length === 1) {
      const rect = e.currentTarget.getBoundingClientRect()
      selectAt(viewG + (e.clientX - rect.left - W / 2) / zoom)
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
  const hd = useRef<{ id: string; edge: 'start' | 'end'; x0: number; t0: number; pxs: number; recorded: boolean } | null>(null)
  const handleDown = (edge: 'start' | 'end', pxs: number) => (e: PointerEvent) => {
    if (!target) return
    e.stopPropagation()
    capture(e.currentTarget, e.pointerId)
    stopAll()
    // 引いている間に再生ヘッドが動いても、対象が変わらないよう、選んだ状態にする
    setSel(target.id)
    hd.current = { id: target.id, edge, x0: e.clientX, t0: target[edge], pxs, recorded: false }
    freezeView()
  }
  const handleMove = (e: PointerEvent) => {
    const d = hd.current
    if (!d || !targetClip) return
    e.stopPropagation()
    // 動かし始めたときに、取り消しの 1 手として積む（触れただけでは、積まない）
    if (!d.recorded) {
      d.recorded = true
      checkpoint()
    }
    const key = segKey(d.id)
    const t = Math.min(targetClip.d, Math.max(0, d.t0 + (e.clientX - d.x0) / d.pxs))
    commit((doc0) => ({ ...doc0, segs: { ...doc0.segs, [key]: trimEdge(doc0.segs[key], key, d.id, d.edge, t, durs[key]) } }), false)
    seekGlobal(targetClip.off + Math.min(targetClip.d - 0.01, t), false)
  }
  const handleUp = () => {
    if (hd.current) releaseView()
    hd.current = null
  }

  // ---- 操作 ----
  const inTarget = !!target && !!targetClip && g - targetClip.off - target.start >= MIN_SEG && targetClip.off + target.end - g >= MIN_SEG
  const canSplit = ready && !busy && inTarget
  /** 外せるのは、残す区間が 1 つ以上残るとき（ぜんぶ外すと、できあがりが空になる） */
  const canDelete = (() => {
    if (!ready || busy) return false
    // テキストを選んでいるときは、「削除」はそのテキストを消す
    if (selT) return true
    if (!target) return false
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
    if (selT) {
      removeText()
      return
    }
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

  // ---- テキスト ----
  const curLay = lay.find((c) => c.key === curKey)
  const localNow = g - (curLay?.off ?? 0)
  // 外した（斜線の）区間では、できあがりに無いので、プレビューにも出さない（書き出しと同じ見え方にする）
  const inOff = ready && !!segAtG(g)?.off
  const shownTexts = ready && !inOff ? texts.filter((o) => o.key === curKey && localNow >= o.start && localNow < o.end) : []
  const shownSig = shownTexts.map((o) => `${o.id}|${o.text}|${o.x}|${o.y}|${o.size}|${o.color}|${o.stroke}|${o.font}|${o.plate}|${o.plateColor}`).join('/')
  const laneOf = textLanes(texts, Object.fromEntries(lay.map((c) => [c.key, c.off])))
  const laneCount = texts.length ? Math.min(3, Math.max(...Object.values(laneOf)) + 1) : 0
  const [selBox, setSelBox] = useState<TextBox>()

  const patchText = (id: string, patch: Partial<TextOverlay> | ((o: TextOverlay) => TextOverlay), record = true) =>
    commit((d) => ({ ...d, texts: d.texts.map((o) => (o.id === id ? (typeof patch === 'function' ? patch(o) : { ...o, ...patch }) : o)) }), record)

  // 絵の位置を測る（動画は、枠の中に収まる大きさで出る）
  useEffect(() => {
    const measure = () => {
      const v = video.current
      const st = stage.current
      const sz = sizes[curKey]
      if (!v || !st || !sz || !sz.w || !sz.h) return
      const er = v.getBoundingClientRect()
      const sr = st.getBoundingClientRect()
      const k = Math.min(er.width / sz.w, er.height / sz.h)
      setVr({ x: er.left - sr.left + (er.width - sz.w * k) / 2, y: er.top - sr.top + (er.height - sz.h * k) / 2, w: sz.w * k, h: sz.h * k })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (stage.current) ro.observe(stage.current)
    return () => ro.disconnect()
  }, [sizes, curKey, ready])

  // 見えているテキストを、絵の上に描く（書き出しと同じ drawText）
  useEffect(() => {
    const c = textCanvas.current
    if (!c || !vr) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const cw = Math.max(1, Math.round(vr.w * dpr))
    const ch = Math.max(1, Math.round(vr.h * dpr))
    if (c.width !== cw || c.height !== ch) {
      c.width = cw
      c.height = ch
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cw, ch)
    const boxes: { id: string; box: TextBox }[] = []
    for (const o of shownTexts) {
      const b = drawText(ctx, cw, ch, o)
      if (b) boxes.push({ id: o.id, box: b })
    }
    textBoxes.current = boxes
    const sb = boxes.find((x) => x.id === selText)?.box
    setSelBox(sb ? { x: sb.x / dpr, y: sb.y / dpr, w: sb.w / dpr, h: sb.h / dpr } : undefined)
    // shownTexts は shownSig で見る（毎コマの描き直しを、見た目が変わったときだけにする）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vr, shownSig, selText, fontTick])

  // 同梱のフォント（手書き）は、使うとき・選ぶ一覧を出すときに読み込み、読めたら描き直す
  const fontSig = texts.map((o) => o.font).join(',') + (selT && styleTab === 'font' ? ',all' : '')
  useEffect(() => {
    const ids = fontSig.includes('all') ? TEXT_FONTS.map((f) => f.id) : (fontSig.split(',').filter(Boolean) as (typeof TEXT_FONTS)[number]['id'][])
    if (ids.length === 0) return
    let cancelled = false
    void loadTextFonts(ids).then(() => !cancelled && setFontTick((n) => n + 1))
    return () => {
      cancelled = true
    }
  }, [fontSig])

  /** カラーピッカーで選んだ色（選んでいる間は、細かく変わるので、取り消しの 1 手は、開いて最初の 1 回だけ積む） */
  const pickerChange = (c: string, key: 'color' | 'plateColor' | 'stroke' = 'color') => {
    if (!selT) return
    if (!pickerRecorded.current) {
      pickerRecorded.current = true
      checkpoint()
    }
    patchText(selT.id, { [key]: c }, false)
  }

  // 打つ欄は、出していない間は、読み取り専用にして focus を外す（blur だけだと、iPhone のキーボードが残ることがある）
  const focusText = () => {
    const ta = textInput.current
    if (!ta) return
    ta.readOnly = false
    ta.focus()
  }
  const blurText = () => {
    const ta = textInput.current
    if (!ta) return
    ta.readOnly = true
    ta.blur()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }

  const addText = () => {
    if (!ready || busy) return
    stopAll()
    const { c, local } = locate(g)
    const base = newText(c.key, local, c.d)
    // 同じ時間に、すでにテキストがあれば、重ならないよう、上にずらして置く
    const sameTime = texts.filter((x) => x.key === base.key && x.start < base.end && x.end > base.start).length
    const o = { ...base, y: Math.max(0.2, base.y - 0.1 * sameTime) }
    commit((d) => ({ ...d, texts: [...d.texts, o] }))
    setSelText(o.id)
    freshText.current = true
    editingRef.current = true
    setEditing(true)
    // キーボードを出すには、タップの操作の中で focus する
    focusText()
  }
  const startEdit = () => {
    if (!selT || busy) return
    stopAll()
    freshText.current = false
    checkpoint()
    editingRef.current = true
    setEditing(true)
    focusText()
  }
  const finishEdit = () => {
    if (!editingRef.current) return
    editingRef.current = false
    blurText()
    setEditing(false)
    const o = selT
    if (o && !o.text.trim()) {
      // 何も打たなかったら、置く前に戻す（やり直しにも残さない）。打ったものを消したときは、そのテキストを消す
      if (freshText.current) setHist((h) => (h.past.length ? { doc: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: h.future } : h))
      else commit((d) => ({ ...d, texts: d.texts.filter((x) => x.id !== o.id) }))
      setSelText(undefined)
    }
    freshText.current = false
  }
  const removeText = () => {
    if (!selT) return
    editingRef.current = false
    blurText()
    setEditing(false)
    commit((d) => ({ ...d, texts: d.texts.filter((x) => x.id !== selT.id) }))
    setSelText(undefined)
  }

  // 絵の上：つかんで動かす・2 本指で大きさ・タップで選ぶ（選んだものをもう一度タップで、文字を直す）。何もないところは、再生・停止（選んでいれば、選びを外す）
  const tPts = useRef(new Map<number, { x: number; y: number }>())
  const tDrag = useRef<{ id?: string; x0: number; y0: number; ox: number; oy: number; moved: boolean; recorded: boolean; wasSel: boolean } | null>(null)
  const pinch = useRef<{ d0: number; s0: number; recorded: boolean } | null>(null)
  /** 角の取っ手で大きさを変えている間：始めの大きさ・中心からの距離・中心（画面の px） */
  const sizeHandle = useRef<{ s0: number; d0: number; cx: number; cy: number; recorded: boolean } | null>(null)
  /** 中央に吸い付いている間、縦の目印を出す */
  const [guideX, setGuideX] = useState(false)
  const textPoint = (e: PointerEvent) => {
    const r = textCanvas.current!.getBoundingClientRect()
    const k = textCanvas.current!.width / r.width
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k }
  }
  // 角の取っ手を引くと、中心からの距離に比例して大きさが変わる
  const sizeDown = (e: PointerEvent) => {
    if (!selT || !selBox || !textCanvas.current) return
    e.stopPropagation()
    capture(e.currentTarget, e.pointerId)
    const r = textCanvas.current.getBoundingClientRect()
    const cx = r.left + selBox.x + selBox.w / 2
    const cy = r.top + selBox.y + selBox.h / 2
    sizeHandle.current = { s0: selT.size, d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1, cx, cy, recorded: false }
  }
  const sizeMove = (e: PointerEvent) => {
    const h = sizeHandle.current
    if (!h || !selT) return
    e.stopPropagation()
    if (!h.recorded) {
      h.recorded = true
      checkpoint()
    }
    const size = Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, (h.s0 * Math.hypot(e.clientX - h.cx, e.clientY - h.cy)) / h.d0))
    patchText(selT.id, { size }, false)
  }
  const sizeUp = () => {
    sizeHandle.current = null
  }
  const textDown = (e: PointerEvent) => {
    capture(e.currentTarget, e.pointerId)
    tPts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (tPts.current.size === 2 && selT) {
      const [a, b] = [...tPts.current.values()]
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: selT.size, recorded: false }
      tDrag.current = null
      return
    }
    const p = textPoint(e)
    const slop = 10 * p.k
    const hit = [...textBoxes.current].reverse().find(({ box }) => p.x >= box.x - slop && p.x <= box.x + box.w + slop && p.y >= box.y - slop && p.y <= box.y + box.h + slop)
    const o = hit && texts.find((x) => x.id === hit.id)
    tDrag.current = { id: o?.id, x0: e.clientX, y0: e.clientY, ox: o?.x ?? 0, oy: o?.y ?? 0, moved: false, recorded: false, wasSel: !!o && o.id === selText }
    if (o) {
      setSelText(o.id)
      stopAll()
    }
  }
  const textMove = (e: PointerEvent) => {
    if (!tPts.current.has(e.pointerId)) return
    tPts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && selT && tPts.current.size === 2) {
      const [a, b] = [...tPts.current.values()]
      if (!pinch.current.recorded) {
        pinch.current.recorded = true
        checkpoint()
      }
      const size = Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, (pinch.current.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d0))
      patchText(selT.id, { size }, false)
      return
    }
    const d = tDrag.current
    if (!d || !d.id) return
    const r = textCanvas.current!.getBoundingClientRect()
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    d.moved = true
    if (!d.recorded) {
      d.recorded = true
      checkpoint()
    }
    const x = snapCenter(Math.min(1, Math.max(0, d.ox + dx / r.width)))
    setGuideX(x === 0.5)
    patchText(d.id, { x, y: Math.min(1, Math.max(0, d.oy + dy / r.height)) }, false)
  }
  const textUp = (e: PointerEvent) => {
    const had = tPts.current.delete(e.pointerId)
    setGuideX(false)
    if (pinch.current) {
      if (tPts.current.size < 2) pinch.current = null
      if (tPts.current.size === 0) tDrag.current = null
      return
    }
    const d = tDrag.current
    if (!had || !d) return
    tDrag.current = null
    if (d.moved) return
    if (d.id) {
      if (d.wasSel) startEdit()
    } else if (editing) finishEdit()
    else if (selText) setSelText(undefined)
    else togglePlay()
  }

  // 時間の帯の端を引いて、表示する時間を変える（引いている間は、その端の絵を出す）
  const th = useRef<{ id: string; edge: 'start' | 'end' | 'move'; x0: number; t0: number; len: number; moved: boolean; recorded: boolean } | null>(null)
  // 帯の中をつかむと、長さを保ったまま、ずらせる（動かさずに離せば、選ぶだけ）
  const textBarDown = (o: TextOverlay) => (e: PointerEvent) => {
    e.stopPropagation()
    capture(e.currentTarget, e.pointerId)
    if (editing) finishEdit()
    stopAll()
    // すでに選んでいる帯を押し直したときは、再生ヘッドを動かさない（先頭を直したあと、末尾の端を引こうとして帯に触れるたびに、先頭へ飛ばないように）
    const reselect = o.id === selText
    setSelText(o.id)
    th.current = { id: o.id, edge: 'move', x0: e.clientX, t0: o.start, len: o.end - o.start, moved: false, recorded: false }
    const c = lay.find((x) => x.key === o.key)
    if (c && !reselect) seekGlobal(c.off + Math.min(c.d - 0.01, o.start), false)
  }
  const textHandleDown = (o: TextOverlay, edge: 'start' | 'end') => (e: PointerEvent) => {
    e.stopPropagation()
    capture(e.currentTarget, e.pointerId)
    stopAll()
    setSelText(o.id)
    th.current = { id: o.id, edge, x0: e.clientX, t0: o[edge], len: 0, moved: true, recorded: false }
    freezeView()
  }
  const textHandleMove = (e: PointerEvent) => {
    const d = th.current
    const o = d && texts.find((x) => x.id === d.id)
    const c = o && lay.find((x) => x.key === o.key)
    if (!d || !o || !c) return
    e.stopPropagation()
    if (d.edge === 'move' && !d.moved && Math.abs(e.clientX - d.x0) < 5) return
    if (!d.moved) freezeView()
    d.moved = true
    if (!d.recorded) {
      d.recorded = true
      checkpoint()
    }
    if (d.edge === 'move') {
      const start = Math.min(c.d - d.len, Math.max(0, d.t0 + (e.clientX - d.x0) / zoom))
      patchText(d.id, { start, end: start + d.len }, false)
      seekGlobal(c.off + Math.min(c.d - 0.01, start), false)
      return
    }
    const t = Math.min(c.d, Math.max(0, d.t0 + (e.clientX - d.x0) / zoom))
    patchText(d.id, (x) => (d.edge === 'start' ? moveStart(x, t, c.d) : moveEnd(x, t, c.d)), false)
    seekGlobal(c.off + Math.min(c.d - 0.01, t), false)
  }
  const textHandleUp = () => {
    if (th.current?.moved) releaseView()
    th.current = null
  }

  const done = async () => {
    if (!ready || busy) return
    if (!needsCompose) {
      onClose()
      return
    }
    if (ranges.length === 0) return
    stopAll()
    setError(undefined)
    setProgress(0)
    cancelRequested.current = false
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
            source: c.file ? { file: c.file } : { blob: c.blob! },
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
        setProgress,
        () => cancelRequested.current,
        hasText ? await renderTextOverlays(texts, ranges, sizes[ranges[0].key] ?? { w: 1080, h: 1920 }, QUALITY[quality].shortSide) : undefined,
      )
      // やめるのと同時に書き終わったときも、できたものは使わない
      if (cancelRequested.current) return
      onDone(
        file,
        ranges.map((r) => r.key),
        paid,
      )
    } catch (e) {
      // やめたときは、何も出さずに編集へ戻る
      if (e instanceof ComposeCancelled) return
      setError(e instanceof Error ? t.compose.failedWith(e.message) : t.compose.failed)
    } finally {
      setBusy(false)
    }
  }

  /** キャンセル：変えていなければ、そのまま閉じる。変えていれば、確認せず閉じ、親が「元に戻す」のトーストを出す（作っている間は閉じない） */
  const cancel = () => {
    if (editing) {
      finishEdit()
      return
    }
    if (busy) {
      // 作っている間は、書き出しをやめて編集へ戻る（確認もトーストも出さない）。画面は閉じない
      cancelRequested.current = true
      void cancelComposeVideoFiles()
      return
    }
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
  const buildTrack = (pxs: number) =>
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

  // 帯の絵は、再生ヘッドが動くたびには作り直さない（再生中は毎コマ描き直すので、重くなる）
  const ovTrack = useMemo(() => buildTrack(pxs1), [lay, frames, pxs1])
  const cuTrack = useMemo(() => buildTrack(zoom), [lay, frames, zoom])

  // 診断に出す、動画のまわりの状態（描画のたびに最新にする。診断を出していなければ、読まれない）
  const diagInfo = useRef<DiagInfo>({ source: 'blob', clips: 0, segments: 0, filmstrip: false, bgm: false, muted: false, texts: 0 })
  diagInfo.current = {
    source: clips.some((c) => c.src) ? 'file' : 'blob',
    clips: clips.length,
    segments: allSegs.length,
    filmstrip: filmBusy.current,
    bgm: !!bgm,
    muted,
    texts: doc.texts.length,
  }
  const readDiag = useRef(() => diagInfo.current).current
  const holdStart = () => {
    window.clearTimeout(diagHold.current)
    diagHold.current = window.setTimeout(() => setDiag((d) => !d), DIAG_HOLD_MS)
  }
  const holdEnd = () => window.clearTimeout(diagHold.current)

  const delLabel = !selT && target?.off ? t.compose.restore : t.compose.remove

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
        <button className="editor-text-button" onClick={cancel}>
          {t.editor.cancel}
        </button>
        <span
          className="editor-title"
          onPointerDown={holdStart}
          onPointerUp={holdEnd}
          onPointerLeave={holdEnd}
          onPointerCancel={holdEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
          {ready ? formatTime(total) : ''}
        </span>
        <button className="editor-text-button primary" onClick={() => void done()} disabled={!ready || busy}>
          {t.compose.done}
        </button>
      </div>

      {diag && <VideoDiag video={video} info={readDiag} onClose={() => setDiag(false)} />}

      <div className="editor-stage" ref={stage}>
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
        {/* テキスト：絵の上に重ねる canvas（書き出しと同じ描き方）。つかんで動かす・2 本指で大きさ・タップで選ぶ */}
        {vr && ready && (
          <canvas
            ref={textCanvas}
            className="cmp-txt-canvas"
            role="img"
            aria-label={shownTexts.map((o) => o.text).join(' / ') || t.compose.text}
            style={{ left: vr.x, top: vr.y, width: vr.w, height: vr.h, pointerEvents: busy ? 'none' : 'auto' }}
            onPointerDown={textDown}
            onPointerMove={textMove}
            onPointerUp={textUp}
            onPointerCancel={textUp}
          />
        )}
        {vr && selBox && selT && !busy && (
          <>
            <div className="cmp-txt-sel" style={{ left: vr.x + selBox.x, top: vr.y + selBox.y, width: selBox.w, height: selBox.h }} />
            {/* 選んだテキストの角：左上＝消す、右上＝文字を直す、右下＝引いて大きさ（見つけやすいように、箱に付ける） */}
            {!editing && (
              <>
                <button type="button" className="cmp-txt-badge del" aria-label={t.compose.textBadgeDelete} style={{ left: Math.max(2, vr.x + selBox.x - 20), top: Math.max(2, vr.y + selBox.y - 20) }} onClick={removeText}>
                  ×
                </button>
                <button type="button" className="cmp-txt-badge edit" aria-label={t.compose.textBadgeEdit} style={{ left: Math.min(vr.x + vr.w - 28, vr.x + selBox.x + selBox.w - 8), top: Math.max(2, vr.y + selBox.y - 20) }} onClick={startEdit}>
                  <TextIcon size={14} />
                </button>
                <span
                  className="cmp-txt-badge size"
                  role="slider"
                  aria-label={t.compose.textSize}
                  aria-valuenow={selT.size}
                  style={{ left: Math.min(vr.x + vr.w - 28, vr.x + selBox.x + selBox.w - 8), top: Math.min(vr.y + vr.h - 28, vr.y + selBox.y + selBox.h - 8) }}
                  onPointerDown={sizeDown}
                  onPointerMove={sizeMove}
                  onPointerUp={sizeUp}
                  onPointerCancel={sizeUp}
                >
                  ⤡
                </span>
              </>
            )}
          </>
        )}
        {vr && guideX && <div className="cmp-txt-guide" style={{ left: vr.x + vr.w / 2, top: vr.y, height: vr.h }} />}
        {ready && !playing && !busy && !selText && (
          <button className="editor-play" aria-label={t.player.play} onClick={togglePlay}>
            <PlayIcon size={30} />
          </button>
        )}
        {/* 文字を打つところ：キーボードで隠れない、絵の上の端に出す（絵の上には、打った文字がそのまま出る）。出していないときは、見えないだけで、置いてある（タップの操作の中で focus してキーボードを出すため） */}
        <div className={`cmp-txt-edit${editing ? ' on' : ''}`}>
          <textarea
            ref={textInput}
            rows={Math.min(3, Math.max(1, (selT?.text.split('\n').length ?? 1)))}
            readOnly
            value={selT?.text ?? ''}
            placeholder={t.compose.textPlaceholder}
            aria-label={t.compose.text}
            onChange={(e) => selT && patchText(selT.id, { text: e.target.value }, false)}
            onBlur={finishEdit}
          />
          {/* 押した瞬間に、打つ欄の focus が外れると、欄が消えて、押した扱いにならない（1 回目が空振りになる）。focus を動かさず、離したときに確定する */}
          <button type="button" className="editor-text-button primary" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={finishEdit}>
            {t.compose.textDone}
          </button>
        </div>
      </div>

      <div className="editor-panel">
        {error && <p className="trimmer-error">{error}</p>}
        {!ready && !error && <p className="editor-status">{t.editor.loading}</p>}
        {busy && (
          <div className="editor-progress">
            <p>{t.compose.working}</p>
            <div className={progress > 0 ? 'progress' : 'progress indeterminate'} aria-hidden="true">
              <span style={progress > 0 ? { width: `${progress * 100}%` } : undefined} />
            </div>
          </div>
        )}

        {ready && !busy && (
          <>
            {/* 音：元の音のあり・なし（スピーカー 1 つ）・テキスト・BGM（押すと一覧のシート） */}
            {selT && !editing ? (
              <div className="cmp-sound cmp-txt-style">
                {/* 左：設定の種類（フォント・文字の色・背景・大きさ）。右：選んだ種類の中身（横に流せる） */}
                <div className="cmp-style-tabs" role="tablist">
                  {(
                    [
                      ['font', t.compose.textTabFont, <span key="f" className="cmp-tab-aa">Aa</span>],
                      ['style', t.compose.textTabStyle, <span key="y" className="cmp-tab-style" style={{ color: selT.color, WebkitTextStrokeColor: selT.stroke ?? 'transparent', background: selT.plate ? selT.plateColor : undefined }}>あ</span>],
                      ['color', t.compose.textTabColor, <span key="c" className="cmp-tab-dot" style={{ background: selT.color }} />],
                      ['time', t.compose.textTabTime, <svg key="s" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>],
                    ] as const
                  ).map(([id, label, icon]) => (
                    <button key={id} type="button" role="tab" aria-selected={styleTab === id} aria-label={label} className={`cmp-style-tab${styleTab === id ? ' on' : ''}`} onClick={() => setStyleTab(id)}>
                      {icon}
                    </button>
                  ))}
                </div>
                <div className="cmp-style-opts">
                  {styleTab === 'font' &&
                    TEXT_FONTS.map((f, i) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`cmp-font-tile${selT.font === f.id ? ' on' : ''}`}
                        style={{ fontFamily: f.family, fontWeight: f.weight, fontStyle: f.italic ? 'italic' : 'normal', letterSpacing: f.tracking ? `${f.tracking * 0.4}em` : undefined }}
                        aria-label={t.compose.textFonts[i]}
                        aria-pressed={selT.font === f.id}
                        onClick={() => patchText(selT.id, { font: f.id })}
                      >
                        あA
                      </button>
                    ))}
                  {styleTab === 'color' && (
                    <>
                      <Swatches value={selT.color} label={t.compose.textColors} custom={t.compose.textColorCustom} onPick={(c) => patchText(selT.id, { color: c })} onPicker={pickerChange} onPickerOpen={() => (pickerRecorded.current = false)} />
                      {/* ふち・板がついているときだけ、その色も選べる（スタイルで付ける） */}
                      {(selT.stroke || selT.plate) && (
                        <>
                          <span className="cmp-opts-sep" aria-hidden="true" />
                          <span className="cmp-opts-label">{selT.stroke ? t.compose.textColorStroke : t.compose.textColorPlate}</span>
                          <Swatches
                            small
                            value={selT.stroke ?? selT.plateColor}
                            label={t.compose.textColors}
                            custom={t.compose.textColorCustom}
                            onPick={(c) => patchText(selT.id, selT.stroke ? { stroke: c } : { plateColor: c })}
                            onPicker={(c) => pickerChange(c, selT.stroke ? 'stroke' : 'plateColor')}
                            onPickerOpen={() => (pickerRecorded.current = false)}
                          />
                        </>
                      )}
                    </>
                  )}
                  {styleTab === 'style' &&
                    TEXT_STYLES.map((st, i) => (
                      <button
                        key={st.id}
                        type="button"
                        className={`cmp-style-tile${currentStyle(selT) === st.id ? ' on' : ''}`}
                        aria-label={t.compose.textStyles[i]}
                        aria-pressed={currentStyle(selT) === st.id}
                        onClick={() => patchText(selT.id, (o) => applyStyle(o, st.id))}
                      >
                        <span className="cmp-style-sample" style={{ color: st.color, WebkitTextStrokeColor: st.stroke ?? 'transparent', background: st.plate ? st.plateColor : undefined, textShadow: !st.stroke && !st.plate ? '0 1px 3px rgb(0 0 0 / 70%)' : undefined }}>
                          あA
                        </span>
                      </button>
                    ))}
                  {styleTab === 'time' &&
                    [0, 1, 2].map((i) => {
                      const c = lay.find((x) => x.key === selT.key)
                      const at = Math.min(c?.d ?? 0, Math.max(0, g - (c?.off ?? 0)))
                      return (
                        <button
                          key={i}
                          type="button"
                          className="cmp-time-chip"
                          aria-label={t.compose.textTimeLabel[i]}
                          onClick={() => c && patchText(selT.id, (o) => (i === 0 ? fitAll(o, c.d) : i === 1 ? fitFrom(o, at, c.d) : fitTo(o, at, c.d)))}
                        >
                          {t.compose.textTimeShort[i]}
                        </button>
                      )
                    })}
                </div>
              </div>
            ) : (
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
              <button type="button" className="editor-text-button bgm-button" onClick={addText}>
                <TextIcon size={18} />
                {t.compose.text}
              </button>
              {BUNDLED_BGM.length > 0 && (
                <>
                  {/* 行の名前（BGM）と、いまの選択（なし・曲名）。押すと、一覧のシートが開く */}
                  <button type="button" className="editor-text-button bgm-button bgm-row-button" aria-haspopup="dialog" onClick={openBgmSheet}>
                    <MusicIcon size={18} />
                    <span className="bgm-row-label">{t.compose.bgm}</span>
                    <span className={`bgm-row-value${bgm ? ' on' : ''}`}>{bgm ? bgmTitle(bgm) : t.compose.bgmOff}</span>
                    <ChevronDownIcon size={16} />
                  </button>
                  <input
                    ref={bgmInput}
                    hidden
                    type="file"
                    accept="audio/*,.m4a,.mp3,.wav,.aac"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        previewNext.current = true
                        setBgm({ kind: 'file', file })
                        setBgmListOpen(false)
                      }
                      e.target.value = ''
                    }}
                  />
                </>
              )}
            </div>
            )}
            {/* 曲を選んだら、音量（0〜100%。指でなぞって決める） */}
            {bgm && !(selT && !editing) && (
              <div className="bgm-volume-row">
                <SpeakerIcon size={18} />
                <input
                  type="range"
                  className="bgm-volume"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(bgmVolume * 100)}
                  aria-label={t.compose.bgmVolume}
                  onChange={(e) => setBgmVolume(Number(e.target.value) / 100)}
                />
                <span className="bgm-volume-value">{Math.round(bgmVolume * 100)}%</span>
              </div>
            )}
            {bgmListOpen && (
              <BgmSheet
                current={bgm}
                onPick={(choice) => {
                  setBgmListOpen(false)
                  if (!choice) {
                    setBgm(undefined)
                    return
                  }
                  previewNext.current = true
                  setBgm(choice)
                }}
                onFile={() => bgmInput.current?.click()}
                onClose={() => setBgmListOpen(false)}
              />
            )}

            {/* 上の段：全体（なぞると、再生ヘッドが動く） */}
            <div className="cmp-ov">
              <div className="cmp-ov-in" ref={ov} style={{ width: ovW }} onPointerDown={ovDown} onPointerMove={(e) => e.buttons && !hd.current && scrubTo(ovAt(e), pxs1)}>
                {ovTrack}
                {frame(pxs1)}
                {texts.map((o) => {
                  const c = lay.find((x) => x.key === o.key)
                  return c ? <div key={o.id} className={`cmp-ov-txt${o.id === selText ? ' on' : ''}`} style={{ left: (c.off + o.start) * pxs1, width: Math.max(2, (o.end - o.start) * pxs1) }} aria-hidden="true" /> : null
                })}
                <div className="filmstrip-head" style={{ left: g * pxs1 }} aria-hidden="true" />
              </div>
            </div>

            {/* 下の段：再生ヘッドの周りの拡大（再生ヘッドは中央に固定。2 本指で倍率） */}
            <div className="cmp-cu" style={{ height: 76 + laneCount * LANE }} onPointerDown={cuDown} onPointerMove={cuMove} onPointerUp={cuUp} onPointerCancel={cuUp}>
              <div className={`cmp-cu-in${settling ? ' settling' : ''}`} style={{ width: T * zoom, transform: `translateX(${W / 2 - viewG * zoom}px)` }}>
                {cuTrack}
                {frame(zoom)}
              </div>
              {/* テキストの時間の帯（動画の下）。タップで選び、選んだ帯の両端を引いて、表示する時間を変える */}
              {laneCount > 0 && (
                <div className={`cmp-cu-txt${settling ? ' settling' : ''}`} style={{ top: 76, height: laneCount * LANE, width: T * zoom, transform: `translateX(${W / 2 - viewG * zoom}px)` }}>
                  {texts.map((o) => {
                    const c = lay.find((x) => x.key === o.key)
                    if (!c) return null
                    const on = o.id === selText
                    return (
                      <div
                        key={o.id}
                        className={`cmp-txt-bar${on ? ' on' : ''}`}
                        style={{ left: (c.off + o.start) * zoom, width: Math.max(8, (o.end - o.start) * zoom), top: Math.min(2, laneOf[o.id] ?? 0) * LANE + 2 }}
                        onPointerDown={textBarDown(o)}
                        onPointerMove={textHandleMove}
                        onPointerUp={textHandleUp}
                        onPointerCancel={textHandleUp}
                      >
                        {/* 外した（斜線の）区間にかかる部分は、できあがりに入らないので、斜線で示す */}
                        {c.segs
                          .filter((sg) => sg.off && sg.end > o.start && sg.start < o.end)
                          .map((sg) => (
                            <u key={sg.id} className="cmp-txt-off" style={{ left: (Math.max(sg.start, o.start) - o.start) * zoom, width: (Math.min(sg.end, o.end) - Math.max(sg.start, o.start)) * zoom }} />
                          ))}
                        <span>{o.text.split('\n')[0] || t.compose.textPlaceholder}</span>
                        {on && (
                          <>
                            <i className="start" role="slider" aria-label={t.editor.start} aria-valuenow={o.start} onPointerDown={textHandleDown(o, 'start')} onPointerMove={textHandleMove} onPointerUp={textHandleUp} onPointerCancel={textHandleUp} />
                            <i className="end" role="slider" aria-label={t.editor.end} aria-valuenow={o.end} onPointerDown={textHandleDown(o, 'end')} onPointerMove={textHandleMove} onPointerUp={textHandleUp} onPointerCancel={textHandleUp} />
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              <div className={`filmstrip-head${settling ? ' settling' : ''}`} style={{ left: W / 2 + (g - viewG) * zoom }} aria-hidden="true" />
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
          exhausted
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

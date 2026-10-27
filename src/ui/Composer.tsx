import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { BUNDLED_BGM, bgmBlob, bgmExtension, bgmTitle, type BgmChoice } from '../data/bgm'
import { canSplitAt, composeClips, moveEdge } from '../data/compose'
import { inMemory, probeDuration } from '../data/mediaPrep'
import type { VideoQuality } from '../data/videoStorage'
import { BackIcon, ForwardIcon, MusicIcon, PauseIcon, PlayIcon, SpeakerIcon } from './icons'
import { PlusSheet } from './PlusSheet'
import { FRAMES, formatTime, makeFilmstrip, makeFramesAt } from './Trimmer'
import { useBackHandler } from './useBackHandler'
import { t } from '../i18n'

/** つなぐ動画 1 本。file は、アプリのファイルにある元の動画の場所（あれば、そのまま書き出しに渡す） */
export interface ComposerClip {
  key: string
  blob: Blob
  file?: string
}

/** 並びの 1 つ分（動画の 1 区間）。分割すると、同じ動画（key）から区間が増える。同じ動画の区間は、境目で隣とつながる（重ならない） */
interface Row {
  /** 並びの中での名前（最初は動画の key と同じ。分割で増えた区間は、別の名前） */
  id: string
  /** 元の動画（clips の key） */
  key: string
  /** 動画の長さ（秒）。読み取るまでは 0 */
  duration: number
  start: number
  end: number
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

const trimmed = (r: Row) => r.duration > 0 && (r.start > 0.05 || r.end < r.duration - 0.05)

/**
 * 動画をつなぐ（iPhone の写真アプリのように）。下に動画を並べ、選んだ1本の両端の取っ手で範囲を決める。
 * 並べ替え・分割（白い線の位置で 2 つに分ける）・外す（フィルムで斜線になり、「戻す」で戻せる）も、選んだ1本に対して行う。分割した区間の取っ手は、隣との境目を動かす。「完了」で、並べた順につなぎ、onDone に渡す（つなぎ目はカットのみ）。
 * 作っている間は閉じられない（途中で止めると、元の動画と見分けがつかなくなるため）
 */
export function Composer({
  clips: initialClips,
  quality,
  fileName,
  mayUsePaid,
  onDone,
  onClose,
}: {
  clips: ComposerClip[]
  quality: VideoQuality
  fileName: string
  /** 有料の操作（2 本以上をつなぐ・BGM）をしてよいか。Plus を買っている・無料の回数が残っている間は true */
  mayUsePaid: () => Promise<boolean>
  /** order は、つないだ動画の並び順（clips の key）。使わなかった動画は含まない。paid は、有料の操作を使ったか（無料の回数に数える） */
  onDone: (file: File, order: string[], paid: boolean) => void
  onClose: () => void
}) {
  // 開いた時点の動画を使い続ける（親の再描画のたびに、新しい配列が渡されても、長さを読み直さない）
  const [clips] = useState(initialClips)
  const video = useRef<HTMLVideoElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const dragging = useRef<'start' | 'end' | 'head' | null>(null)
  const playUntil = useRef<number | null>(null)
  const [rows, setRows] = useState<Row[]>(() => clips.map((c) => ({ id: c.key, key: c.key, duration: 0, start: 0, end: 0 })))
  const [selected, setSelected] = useState(0)
  /** 外した区間（新しい順に、末尾へ）。並びからは消えるが、動画の中ではそこに残り（フィルムで斜線）、「戻す」で元の位置へ戻せる。index は、外す前の並びの中の位置 */
  const [removed, setRemoved] = useState<{ row: Row; index: number }[]>([])
  const [url, setUrl] = useState<string>()
  const [frames, setFrames] = useState<Record<string, string[]>>({})
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  /** 選んだ BGM と音量（0〜1。元の動画の音とは別に決める） */
  const [bgm, setBgm] = useState<BgmChoice>()
  const [bgmVolume, setBgmVolume] = useState(0.3)
  const [bgmListOpen, setBgmListOpen] = useState(false)
  const bgmInput = useRef<HTMLInputElement>(null)
  const bgmVolumeRef = useRef(0.3)
  /** 元の動画の音を使わない */
  const [muted, setMuted] = useState(false)
  /** 並べた順に続けて再生している（取っ手を動かす・止めると、やめる） */
  const [sequence, setSequence] = useState(false)
  const sequenceRef = useRef(false)
  /** 次の動画を読み込んだら、続けて再生する */
  const resume = useRef(false)
  /** 動画ごとの読み込み済みの URL（続けて再生するとき、次の動画をすぐ出すため） */
  const urls = useRef(new Map<string, string>())
  const urlPromises = useRef(new Map<string, Promise<string>>())
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [plusSheet, setPlusSheet] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const bgmAudio = useRef<{ el: HTMLAudioElement; ctx: AudioContext; gain: GainNode } | null>(null)

  const row = rows[selected]
  const clipOf = (key: string) => clips.find((c) => c.key === key)!
  const selectedKey = row?.key
  const duration = row?.duration ?? 0

  // 全部の動画の長さを読み取る（つなぐ長さを出すため）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const c of clips) {
        try {
          const d = await blobDuration(c.blob)
          if (cancelled) return
          setRows((prev) => prev.map((r) => (r.key === c.key && r.duration === 0 ? { ...r, duration: d, end: d } : r)))
        } catch {
          if (!cancelled) setError(t.editor.durationFailed)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clips])

  /** 動画を、メモリに写して再生できるようにした URL（iPhone で IndexedDB の動画を直接再生できないことがあるため）。
   * 一度写したものは取っておく（続けて再生するとき、並びの絵を作るとき、すぐ使えるように）。画面を閉じるときにまとめて解放する */
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

  // 選んだ動画を、再生できるようにする
  useEffect(() => {
    if (!selectedKey) return
    let cancelled = false
    setPlaying(false)
    setCurrent(0)
    const cached = urls.current.get(selectedKey)
    if (cached) {
      setUrl(cached)
      return
    }
    setUrl(undefined)
    urlFor(selectedKey)
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch(() => setError(t.common.videoLoadFailed))
    return () => {
      cancelled = true
    }
    // urlFor は clips から引くだけなので、選んだ動画が変わったときだけ読み直す
  }, [selectedKey])

  useEffect(() => {
    const promises = urlPromises.current
    const cache = urls.current
    return () => {
      for (const p of promises.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => {})
      promises.clear()
      cache.clear()
    }
  }, [])

  // 並びの小さな絵（区間の始めのコマ。保存済みの絵は、できあがりの最後のコマなので使わない）。分割で増えた区間の分も作る
  const thumbBusy = useRef(new Set<string>())
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const r of rows) {
        if (r.duration <= 0 || thumbs[r.id] || thumbBusy.current.has(r.id)) continue
        thumbBusy.current.add(r.id)
        try {
          const u = await urlFor(r.key)
          const [frame] = await makeFramesAt(u, [Math.min(r.start + 0.1, r.duration - 0.05)], () => cancelled)
          if (frame && !cancelled) setThumbs((prev) => ({ ...prev, [r.id]: frame }))
        } catch {
          // 絵が作れなくても、番号と長さで見分けられる
        } finally {
          thumbBusy.current.delete(r.id)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // 区間が増えたとき・長さが分かったときだけ（取っ手を動かすたびには、作り直さない）
  }, [rows.map((r) => `${r.id}:${r.duration > 0}`).join()])

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

  // フィルムのコマ（選んだ動画の分を、一度だけ作る）
  useEffect(() => {
    if (!url || !selectedKey || duration <= 0 || frames[selectedKey]) return
    let cancelled = false
    const key = selectedKey
    makeFilmstrip(url, duration, FRAMES, () => cancelled)
      .then((film) => {
        if (!cancelled) setFrames((prev) => ({ ...prev, [key]: film }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // frames は、作り終えたかの確認にだけ使う（作るたびに読み直さない）
  }, [url, selectedKey, duration])

  // iPhone は、タップするまで動画のデータを読み込まず、最初のコマが出ない。音なしで一度再生して止め、先頭のコマを出す。
  // 続けて再生している途中なら、止めずに、この動画の範囲の始めから再生する
  useEffect(() => {
    const v = video.current
    if (!v || !url || duration <= 0) return
    let cancelled = false
    void (async () => {
      const r = rows[selected]
      if (resume.current) {
        resume.current = false
        v.muted = true
        await v.play().catch(() => {})
        if (cancelled || !r) return
        v.currentTime = r.start
        playUntil.current = r.end
        v.muted = muted
        return
      }
      v.muted = true
      await v.play().catch(() => {})
      v.pause()
      if (cancelled) return
      v.currentTime = r?.start ?? 0
      v.muted = muted
    })()
    return () => {
      cancelled = true
    }
    // 動画を読み込んだとき（選んだ動画が変わったとき）だけ。取っ手を動かすたびには、やり直さない
  }, [url, duration > 0])

  // 同じ動画の別の区間を選んだとき（分割したあと）は、動画を読み込み直さないので、その区間の始めへ移る
  useEffect(() => {
    const v = video.current
    if (!v || !row || sequenceRef.current) return
    v.currentTime = row.start
    setCurrent(row.start)
    // 区間を選び直したときだけ（取っ手を動かすたびには、動かさない）
  }, [row?.id])

  /** 外した区間も含む、いまの全区間（境目を動かすとき、隣を探すため） */
  const spans: Row[] = [...rows, ...removed.map((x) => x.row)]

  /** 区間の端を動かす。同じ動画の隣の区間の端も一緒に動く（外した区間も）ので、重ならない */
  const moveSpanEdge = (r: Row, edge: 'start' | 'end', value: number) => {
    const moves = moveEdge(spans, r.id, edge, value, r.duration)
    const apply = (x: Row) => {
      const m = moves.find((v) => v.id === x.id)
      return m ? { ...x, start: m.start, end: m.end } : x
    }
    setRows((prev) => prev.map(apply))
    setRemoved((prev) => prev.map((x) => ({ ...x, row: apply(x.row) })))
    const m = moves.find((v) => v.id === r.id)
    return m ? m[edge] : value
  }

  const seek = (time: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = time
    setCurrent(time)
  }

  /** 再生を止める（BGM も） */
  const stopAll = () => {
    video.current?.pause()
    bgmAudio.current?.el.pause()
    sequenceRef.current = false
    resume.current = false
    playUntil.current = null
    setSequence(false)
  }

  /** この動画の範囲の終わりに来たら、続けて再生しているときは次の動画へ、そうでなければ止める */
  const checkEnd = () => {
    const v = video.current
    if (!v || playUntil.current === null || v.currentTime < playUntil.current) return
    playUntil.current = null
    const next = rows[selected + 1]
    if (sequenceRef.current && next && next.key === row?.key) {
      // 同じ動画の次の区間（分割したもの）：読み込み直さず、その位置へ飛ぶ
      v.currentTime = next.start
      playUntil.current = next.end
      setSelected(selected + 1)
    } else if (sequenceRef.current && next) {
      resume.current = true
      v.pause()
      setSelected(selected + 1)
    } else {
      stopAll()
    }
  }

  const onTimeUpdate = () => {
    const v = video.current
    if (!v) return
    setCurrent(v.currentTime)
    checkEnd()
  }

  // timeupdate は 0.25 秒ごとなので、再生中は、範囲の終わりを細かく見る（つなぎ目を、書き出しに近づける）
  useEffect(() => {
    if (!playing) return
    let id = requestAnimationFrame(function tick() {
      checkEnd()
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
  }, [playing, selected, rows.length])

  /** 選んだ動画の範囲から、並べた順に最後まで再生する。BGM も、つないだときと同じ位置から流す */
  const togglePlay = () => {
    const v = video.current
    if (!v || !row) return
    if (playing || sequence) {
      stopAll()
      return
    }
    if (v.currentTime < row.start || v.currentTime >= row.end - 0.05) v.currentTime = row.start
    playUntil.current = row.end
    v.muted = muted
    sequenceRef.current = true
    setSequence(true)
    void v.play()
    const a = bgmAudio.current
    if (a) {
      const before = rows.slice(0, selected).reduce((sum, r) => sum + (r.end - r.start), 0)
      const at = before + Math.max(0, v.currentTime - row.start)
      if (a.ctx.state === 'suspended') void a.ctx.resume()
      a.el.currentTime = a.el.duration > 0 && Number.isFinite(a.el.duration) ? at % a.el.duration : 0
      void a.el.play().catch(() => {})
    }
  }

  /** 並びの動画を選ぶ（再生中なら止める） */
  const choose = (i: number) => {
    if (i === selected) return
    stopAll()
    setSelected(i)
  }

  // ---- フィルムの取っ手（Trimmer と同じ動き） ----
  const timeAt = (clientX: number) => {
    const rect = strip.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration))
  }

  const onPointerDown = (which: 'start' | 'end' | 'head') => (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 取れなくても、フィルムの上で動かす分には動く
    }
    stopAll()
    dragging.current = which
    if (which === 'head' && row) seek(Math.min(row.end, Math.max(row.start, timeAt(e.clientX))))
  }

  const onPointerMove = (e: PointerEvent) => {
    const which = dragging.current
    if (!which || !row) return
    const time = timeAt(e.clientX)
    if (which === 'start') seek(moveSpanEdge(row, 'start', time))
    else if (which === 'end') seek(moveSpanEdge(row, 'end', time))
    else {
      seek(Math.min(row.end, Math.max(row.start, time)))
    }
  }

  const onPointerUp = () => {
    dragging.current = null
  }

  /** 取っ手を、キーボードや読み上げ（上下のスワイプ）でも0.1秒ずつ動かせるようにする */
  const nudge = (which: 'start' | 'end') => (e: KeyboardEvent) => {
    if (!row) return
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.1 : 0
    if (!step) return
    e.preventDefault()
    seek(moveSpanEdge(row, which, row[which] + step))
  }

  const move = (delta: -1 | 1) => {
    const to = selected + delta
    if (to < 0 || to >= rows.length) return
    stopAll()
    setRows((prev) => {
      const next = [...prev]
      ;[next[selected], next[to]] = [next[to], next[selected]]
      return next
    })
    setSelected(to)
  }

  /** いまの位置（白い線）で、選んだ区間を 2 つに分ける。どちらも最短の長さ以上あるときだけ */
  const canSplit = !!row && canSplitAt(row.start, row.end, current)
  const splitCount = useRef(0)
  const split = () => {
    if (!row || !canSplit) return
    stopAll()
    const at = current
    const added: Row = { ...row, id: `${row.key}#${++splitCount.current}`, start: at }
    setRows((prev) => prev.flatMap((r) => (r.id === row.id ? [{ ...r, end: at }, added] : [r])))
    setSelected(selected + 1)
  }

  /** 選んだ区間を外す。並びからは消え、フィルムでは斜線になる（残りが 1 つだけのときは外せない） */
  const remove = () => {
    if (rows.length <= 1 || !row || row.duration <= 0) return
    stopAll()
    setRemoved((prev) => [...prev, { row, index: selected }])
    setRows((prev) => prev.filter((_, i) => i !== selected))
    setSelected((s) => Math.max(0, Math.min(s, rows.length - 2)))
  }

  /** 最後に外した区間を、外す前の位置へ戻す */
  const restore = () => {
    const last = removed[removed.length - 1]
    if (!last) return
    stopAll()
    const at = Math.min(last.index, rows.length)
    setRemoved((prev) => prev.slice(0, -1))
    setRows((prev) => [...prev.slice(0, at), last.row, ...prev.slice(at)])
    setSelected(at)
  }

  const ready = rows.every((r) => r.duration > 0)
  const total = rows.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0)
  /** 有料の操作（2 本以上をつなぐ・BGM）。切り取りと音を消すだけなら、いつでも無料 */
  const paid = rows.length > 1 || !!bgm
  /** 書き出しが要るか（複数をつなぐ・BGM・音を消す・切り取り・区間や動画を外す） */
  const needsCompose = paid || muted || removed.length > 0 || rows.some(trimmed)
  /** 開いたときから、手を加えたか（やめるとき、確認を出すかの判断。開いただけでは、変えていない） */
  const dirty = !!bgm || muted || removed.length > 0 || rows.some(trimmed) || rows.length !== clips.length || rows.some((r, i) => r.id !== clips[i]?.key)

  const done = async () => {
    if (!ready || busy) return
    if (!needsCompose) {
      onClose()
      return
    }
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
        rows.map((r) => {
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
        rows.map((r) => r.key),
        paid,
      )
    } catch (e) {
      setError(e instanceof Error ? t.compose.failedWith(e.message) : t.compose.failed)
    } finally {
      setBusy(false)
    }
  }

  /** 変えていれば、確認してから閉じる（作っている間は閉じない） */
  const requestClose = () => {
    if (busy) return
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  useBackHandler(() => {
    if (confirmClose) setConfirmClose(false)
    else requestClose()
    return true
  })

  const pct = (time: number) => `${(duration > 0 ? time / duration : 0) * 100}%`
  const length = row ? row.end - row.start : 0
  const film = selectedKey ? frames[selectedKey] : undefined
  // 選んだ動画の区間（残した・外した）を、動画の中の位置の順に。両端の外（切り取った部分）と、外した区間は暗くする。区間のあいだの境目に線を引く
  const sameClip = spans.filter((r) => r.key === selectedKey).sort((a, b) => a.start - b.start)
  const keptIds = new Set(rows.map((r) => r.id))
  const clipStart = sameClip[0]?.start ?? 0
  const clipEnd = sameClip[sameClip.length - 1]?.end ?? 0

  return (
    <div className="recorder editor" role="dialog" aria-modal="true" aria-label={t.compose.title}>
      <div className="editor-top">
        <button className="editor-text-button" onClick={requestClose} disabled={busy}>
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
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={busy ? undefined : togglePlay}
        />
        {duration > 0 && !playing && !sequence && !busy && (
          <button className="editor-play" aria-label={t.editor.playRange} onClick={togglePlay}>
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
        {duration > 0 && !busy && (
          <div className="editor-tools">
            <button
              className="editor-play-small"
              aria-label={playing || sequence ? t.player.pause : t.editor.playRange}
              onClick={togglePlay}
            >
              {playing || sequence ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
            </button>
            <div
              className="filmstrip"
              ref={strip}
              onPointerDown={onPointerDown('head')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div className="filmstrip-frames" aria-hidden="true">
                {film && film.length > 0
                  ? film.map((f, i) => <img key={i} src={f} alt="" />)
                  : Array.from({ length: FRAMES }, (_, i) => <span key={i} />)}
              </div>
              <div className="filmstrip-shade" style={{ left: 0, width: pct(clipStart) }} />
              <div className="filmstrip-shade" style={{ left: pct(clipEnd), right: 0 }} />
              {sameClip
                .filter((r) => !keptIds.has(r.id))
                .map((r) => (
                  <div key={r.id} className="filmstrip-shade removed" style={{ left: pct(r.start), width: pct(r.end - r.start) }} />
                ))}
              {sameClip.slice(1).map((r) => (
                <div key={r.id} className="filmstrip-cut" style={{ left: pct(r.start) }} aria-hidden="true" />
              ))}
              <div className="filmstrip-frame" style={{ left: pct(row.start), width: pct(length) }}>
                <span
                  className="filmstrip-handle start"
                  role="slider"
                  aria-label={t.editor.start}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={row.start}
                  aria-valuetext={formatTime(row.start)}
                  tabIndex={0}
                  onKeyDown={nudge('start')}
                  onPointerDown={onPointerDown('start')}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
                <span
                  className="filmstrip-handle end"
                  role="slider"
                  aria-label={t.editor.end}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={row.end}
                  aria-valuetext={formatTime(row.end)}
                  tabIndex={0}
                  onKeyDown={nudge('end')}
                  onPointerDown={onPointerDown('end')}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
              </div>
              <div className="filmstrip-head" style={{ left: pct(current) }} aria-hidden="true" />
            </div>
            <button
              type="button"
              className={`editor-sound${muted ? ' off' : ''}`}
              aria-pressed={muted}
              aria-label={muted ? t.editor.mutedLabel : t.editor.soundLabel}
              onClick={() => setMuted((m) => !m)}
            >
              <SpeakerIcon size={22} off={muted} />
            </button>
          </div>
        )}

        {/* つなぐ動画の並び。押して選び、選んだ1本を並べ替え・外す */}
        <ul className="clip-row" aria-label={t.compose.clips}>
          {rows.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                className={`clip-chip${i === selected ? ' selected' : ''}`}
                aria-pressed={i === selected}
                disabled={busy}
                onClick={() => choose(i)}
              >
                {thumbs[r.id] && <img className="clip-thumb" src={thumbs[r.id]} alt="" />}
                <span className="clip-index">{i + 1}</span>
                <span className="clip-length">{r.duration > 0 ? formatTime(r.end - r.start) : '…'}</span>
              </button>
            </li>
          ))}
        </ul>
        {/* BGM（任意）。同梱の曲が入るまでは出さない（曲の持ち合わせがない人には使えないため）。選んだら、音量を出す。
            曲の一覧の末尾から、ファイルも選べる */}
        {!busy && BUNDLED_BGM.length > 0 && (
          <div className="bgm-row">
            <button
              type="button"
              className="editor-text-button bgm-button"
              onClick={() => setBgmListOpen((o) => !o)}
            >
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
          </div>
        )}
        {!busy && bgmListOpen && (
          <ul className="bgm-list">
            {BUNDLED_BGM.map((track) => (
              <li key={track.id}>
                <button
                  type="button"
                  className="editor-text-button"
                  onClick={() => {
                    setBgm({ kind: 'bundled', track })
                    setBgmListOpen(false)
                  }}
                >
                  {track.title}
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
        {!busy && (
          <div className="clip-tools">
            <button type="button" className="editor-sound" aria-label={t.compose.earlier} disabled={selected === 0} onClick={() => move(-1)}>
              <BackIcon size={20} />
            </button>
            <button
              type="button"
              className="editor-sound"
              aria-label={t.compose.later}
              disabled={selected >= rows.length - 1}
              onClick={() => move(1)}
            >
              <ForwardIcon size={20} />
            </button>
            <button type="button" className="editor-text-button" disabled={!canSplit} onClick={split}>
              {t.compose.split}
            </button>
            <button type="button" className="editor-text-button" disabled={rows.length <= 1} onClick={remove}>
              {t.compose.remove}
            </button>
            {removed.length > 0 && (
              <button type="button" className="editor-text-button" onClick={restore}>
                {t.compose.restore}
              </button>
            )}
          </div>
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
      {confirmClose && !busy && (
        <div className="editor-confirm-backdrop" onClick={() => setConfirmClose(false)}>
          <div className="editor-confirm" role="alertdialog" onClick={(e) => e.stopPropagation()}>
            <p>{t.compose.discardAsk}</p>
            <div className="editor-confirm-actions">
              <button type="button" className="editor-confirm-button danger" onClick={onClose}>
                {t.compose.discard}
              </button>
              <button type="button" className="editor-confirm-button" onClick={() => setConfirmClose(false)}>
                {t.compose.keepEditing}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

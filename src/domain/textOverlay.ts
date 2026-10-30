/**
 * 動画に重ねるテキスト。
 * 位置・大きさは、絵（書き出す動画の 1 コマ）に対する割合で持つ（画面の大きさや、書き出しの画質が変わっても、同じ見た目になる）。
 * 時間は、動画（key）の中の秒で持つ。区間の分割・削除・動画の並べ替えをしても、テキストは、付けた場面に付いてくる。
 * 画面のプレビューと、書き出す画像は、同じ drawText で描く（見た目が、ずれないように）
 */

/**
 * はじめから並べる色。日本のテロップで多い、白・黄・ピンク・水色・赤、と、黒（縁・板用）。
 * 動画の背景（ラテの茶・白い泡）の上でも読めるよう、明るい色は、縁取りと組み合わせて使う。ほかの色は、システムのカラーピッカーで選ぶ
 */
export const TEXT_COLORS = ['#ffffff', '#ffe14d', '#ff7dae', '#6ccbff', '#ff5252', '#1d1712'] as const

/** 背景の板の濃さ（0〜1）。動画が透けて見える程度 */
export const PLATE_ALPHA = 0.8

/** 縁取りの太さ（文字の大きさに対する、縁の外側の幅の割合） */
export const STROKE_RATIO = 0.13

/**
 * スタイル（1 タップで、文字の色・縁取り・背景の板・影をまとめて決める）。
 * 日本のテロップの定番（太い字に、白＋黒縁・黄＋黒縁・白＋色縁・板つき）と、細い字幕風（縁なし・影のみ）
 */
export const TEXT_STYLES = [
  { id: 'white-black', color: '#ffffff', stroke: '#1d1712', plate: false, plateColor: '#1d1712' },
  { id: 'yellow-black', color: '#ffe14d', stroke: '#1d1712', plate: false, plateColor: '#1d1712' },
  { id: 'white-pink', color: '#ffffff', stroke: '#e8458b', plate: false, plateColor: '#1d1712' },
  { id: 'white-blue', color: '#ffffff', stroke: '#2f8fd8', plate: false, plateColor: '#1d1712' },
  { id: 'plate', color: '#ffffff', stroke: null, plate: true, plateColor: '#1d1712' },
  { id: 'plain', color: '#ffffff', stroke: null, plate: false, plateColor: '#1d1712' },
] as const

export type TextStyleId = (typeof TEXT_STYLES)[number]['id']

/** スタイルを、テキストに当てる（位置・時間・文字・大きさ・フォントは変えない） */
export function applyStyle(o: TextOverlay, id: TextStyleId): TextOverlay {
  const st = TEXT_STYLES.find((x) => x.id === id) ?? TEXT_STYLES[0]
  return { ...o, color: st.color, stroke: st.stroke, plate: st.plate, plateColor: st.plateColor }
}

/** いま、どのスタイルに当たっているか（細かく変えて、どれにも当たらなければ undefined） */
export function currentStyle(o: TextOverlay): TextStyleId | undefined {
  return TEXT_STYLES.find((st) => st.color === o.color && st.stroke === o.stroke && st.plate === o.plate && (!st.plate || st.plateColor === o.plateColor))?.id
}

/**
 * フォント。役割の違う 6 種類：ゴシック（字幕）・極太（見出し）・ポップ・丸ゴシック・明朝・手書き。
 * ゴシック・丸ゴシック・明朝は、iPhone・iPad 標準のヒラギノ。極太（Dela Gothic One）・ポップ（Mochiy Pop One）・手書き（Yusei Magic）は、
 * 同梱（いずれも SIL OFL 1.1。public/fonts。日本語の主な文字だけに絞った woff2）。使うときだけ読み込む。
 * プレビューも書き出しも、同じ WebView の canvas で描くので、同じ見た目になる。収録に無い字は、後ろの候補で描く
 */
export const TEXT_FONTS = [
  { id: 'gothic', family: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif', weight: 800 },
  { id: 'dela', family: '"Dela Gothic One", "Hiragino Sans", system-ui, sans-serif', weight: 400 },
  { id: 'pop', family: '"Mochiy Pop One", "Hiragino Maru Gothic ProN", system-ui, sans-serif', weight: 400 },
  { id: 'maru', family: '"Hiragino Maru Gothic ProN", "Zen Maru Gothic", "Hiragino Sans", system-ui, sans-serif', weight: 700 },
  { id: 'mincho', family: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif', weight: 700 },
  { id: 'hand', family: '"Yusei Magic", "Hiragino Maru Gothic ProN", system-ui, sans-serif', weight: 400 },
] as const

export type TextFontId = (typeof TEXT_FONTS)[number]['id']

const fontOf = (id: TextFontId) => TEXT_FONTS.find((f) => f.id === id) ?? TEXT_FONTS[0]

/** 同梱のフォントは、使う前に読み込む（canvas は、読み込み中のフォントで描くと、代わりの字で描いてしまう） */
export async function loadTextFonts(ids: TextFontId[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  await Promise.all(
    [...new Set(ids)].map((id) => {
      const f = fontOf(id)
      return document.fonts.load(`${f.weight} 40px ${f.family}`, 'あいうAa').catch(() => [])
    }),
  )
}

/** 文字の大きさ（絵の高さに対する割合）の範囲と、はじめの値 */
export const TEXT_SIZE_MIN = 0.03
export const TEXT_SIZE_MAX = 0.12
export const TEXT_SIZE_DEFAULT = 0.055

/** 表示する長さ（秒）：はじめの長さと、これ以上は縮められない長さ */
export const TEXT_SECONDS = 3
export const TEXT_MIN_SECONDS = 0.5

/** 折り返す幅（絵の幅に対する割合）。これを超える行は、折り返す */
const WRAP_WIDTH = 0.88

export interface TextOverlay {
  id: string
  /** どの動画（Composer の clip の key）の上か */
  key: string
  /** 動画の中の秒 */
  start: number
  end: number
  text: string
  /** 文字の中心（絵の幅・高さに対する 0〜1） */
  x: number
  y: number
  /** 文字の大きさ（絵の高さに対する割合） */
  size: number
  color: string
  /** 縁取りの色（無ければ null） */
  stroke: string | null
  font: TextFontId
  /** 背景の板を敷くか（敷かないときは、影をつける） */
  plate: boolean
  /** 背景の板の色（plate が true のとき） */
  plateColor: string
}

let counter = 0
export const newTextId = () => `t${Date.now().toString(36)}-${++counter}`

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * 再生ヘッド（動画 key の at 秒）に、新しいテキストを置く。
 * 長さは 3 秒（動画の終わりまで 3 秒なければ、終わりまで。短すぎれば、手前に寄せる）。位置は、下寄りの中央（字幕の位置）
 */
export function newText(key: string, at: number, duration: number): TextOverlay {
  const len = Math.min(TEXT_SECONDS, duration)
  const start = clamp(at, 0, Math.max(0, duration - len))
  return { id: newTextId(), key, start, end: start + len, text: '', x: 0.5, y: 0.78, size: TEXT_SIZE_DEFAULT, color: '#ffffff', stroke: '#1d1712', font: 'gothic', plate: false, plateColor: '#1d1712' }
}

/** 時間の範囲を、動画の長さの中に収める（最小の長さを割らない） */
export function clampRange(start: number, end: number, duration: number): { start: number; end: number } {
  const len = Math.max(TEXT_MIN_SECONDS, end - start)
  const s = clamp(start, 0, Math.max(0, duration - TEXT_MIN_SECONDS))
  return { start: s, end: Math.min(duration, Math.max(s + TEXT_MIN_SECONDS, s + len)) }
}

/** 始めの端を動かす（終わりは動かさない）。終わりより最小の長さ手前まで */
export function moveStart(o: TextOverlay, t: number, _duration: number): TextOverlay {
  return { ...o, start: clamp(t, 0, o.end - TEXT_MIN_SECONDS) }
}

/** 終わりの端を動かす（始めは動かさない）。始めより最小の長さ先から、動画の終わりまで */
export function moveEnd(o: TextOverlay, t: number, duration: number): TextOverlay {
  return { ...o, end: clamp(t, o.start + TEXT_MIN_SECONDS, duration) }
}

/** 表示する時間を、動画の全体にする */
export function fitAll(o: TextOverlay, duration: number): TextOverlay {
  return { ...o, start: 0, end: duration }
}

/** 表示する時間を、再生ヘッド（at 秒）から、動画の終わりまでにする（終わりに近すぎれば、最小の長さを手前に確保） */
export function fitFrom(o: TextOverlay, at: number, duration: number): TextOverlay {
  return { ...o, start: clamp(at, 0, Math.max(0, duration - TEXT_MIN_SECONDS)), end: duration }
}

/** 表示する時間を、動画の始めから、再生ヘッド（at 秒）までにする（始めに近すぎれば、最小の長さを先に確保） */
export function fitTo(o: TextOverlay, at: number, duration: number): TextOverlay {
  return { ...o, start: 0, end: clamp(at, Math.min(TEXT_MIN_SECONDS, duration), duration) }
}

/** 横の位置が、中央に近ければ、中央に吸い付ける */
export function snapCenter(x: number): number {
  return Math.abs(x - 0.5) < 0.025 ? 0.5 : x
}

/** できあがりの時間（秒）に直した、重ねる時間 */
export interface OutputInterval {
  id: string
  start: number
  end: number
}

/**
 * テキストの時間（動画の中の秒）を、できあがり（残す区間をつないだもの）の時間に直す。
 * 外した区間にかかる部分は、できあがりに無いので、そこで途切れる（途中を外すと、2 つに分かれる）。
 * ranges は、できあがりに入る区間（つなぐ順）
 */
export function outputIntervals(texts: TextOverlay[], ranges: { key: string; start: number; end: number }[]): OutputInterval[] {
  const out: OutputInterval[] = []
  for (const o of texts) {
    if (!o.text.trim()) continue
    let at = 0
    for (const r of ranges) {
      const len = r.end - r.start
      if (r.key === o.key) {
        const a = Math.max(o.start, r.start)
        const b = Math.min(o.end, r.end)
        if (b - a > 0.02) out.push({ id: o.id, start: at + (a - r.start), end: at + (b - r.start) })
      }
      at += len
    }
  }
  return out
}

/** 同じ時間に重なるテキストを、別の段に置く（段の番号を返す。重ならなければ 0 段目）。off は、動画ごとの、並びの先頭からの秒 */
export function lanes(texts: TextOverlay[], off: Record<string, number>): Record<string, number> {
  const sorted = [...texts].sort((a, b) => (off[a.key] ?? 0) + a.start - ((off[b.key] ?? 0) + b.start))
  const ends: number[] = []
  const out: Record<string, number> = {}
  for (const o of sorted) {
    const s = (off[o.key] ?? 0) + o.start
    let lane = ends.findIndex((e) => e <= s + 1e-6)
    if (lane < 0) lane = ends.length
    ends[lane] = (off[o.key] ?? 0) + o.end
    out[o.id] = lane
  }
  return out
}

/** 文字の幅を測る関数（canvas の measureText を渡す。テストでは、固定の幅を渡す） */
export type Measure = (s: string) => number

/**
 * 行に分ける：改行で区切り、幅を超える行は、文字ごとに折り返す（日本語は、どこでも折り返せる。
 * 英語は、単語の途中で折れることがあるが、短い字幕では、ほとんど起きない）
 */
export function wrapLines(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let cur = ''
    for (const ch of Array.from(para)) {
      if (cur && measure(cur + ch) > maxWidth) {
        lines.push(cur)
        cur = ch
      } else cur += ch
    }
    lines.push(cur)
  }
  return lines
}

/** 描いたテキストの外枠（絵の左上からの px）。選ぶ・つかむ範囲の判定に使う */
export interface TextBox {
  x: number
  y: number
  w: number
  h: number
}

/** 角の丸い四角の経路（ctx.roundRect は iOS 16 から。対応する iOS 15 でも描けるように、自分で引く） */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + k, y)
  ctx.arcTo(x + w, y, x + w, y + h, k)
  ctx.arcTo(x + w, y + h, x, y + h, k)
  ctx.arcTo(x, y + h, x, y, k)
  ctx.arcTo(x, y, x + w, y, k)
  ctx.closePath()
}

/** #rrggbb に、濃さをつけた rgba に直す */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

const isLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (r * 299 + g * 587 + b * 114) / 1000 > 140
}

/**
 * テキスト 1 つを、絵（W×H px）に描く。描いた外枠を返す。
 * 文字は太め。背景の板なしのときは影をつける（明るい動画の上でも読めるように）
 */
export function drawText(ctx: CanvasRenderingContext2D, W: number, H: number, o: TextOverlay): TextBox | undefined {
  if (!o.text.trim()) return undefined
  const px = o.size * H
  ctx.save()
  const font = fontOf(o.font)
  ctx.font = `${font.weight} ${px}px ${font.family}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = wrapLines(o.text, W * WRAP_WIDTH, (s) => ctx.measureText(s).width)
  const lh = px * 1.3
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const h = lh * lines.length
  const cx = o.x * W
  const cy = o.y * H
  const padX = px * 0.5
  const padY = px * 0.3
  if (o.plate) {
    ctx.fillStyle = withAlpha(o.plateColor, PLATE_ALPHA)
    ctx.beginPath()
    roundedRect(ctx, cx - w / 2 - padX, cy - h / 2 - padY, w + padX * 2, h + padY * 2, px * 0.35)
    ctx.fill()
  } else if (!o.stroke) {
    ctx.shadowColor = isLight(o.color) ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)'
    ctx.shadowBlur = px * 0.14
    ctx.shadowOffsetY = px * 0.04
  }
  if (o.stroke) {
    // 縁取り：太い線を先に引いて、その上に文字を重ねる（外側にだけ縁が出る）。角は丸める
    ctx.lineJoin = 'round'
    ctx.lineWidth = px * STROKE_RATIO * 2
    ctx.strokeStyle = o.stroke
    lines.forEach((l, i) => ctx.strokeText(l, cx, cy - h / 2 + lh * (i + 0.5)))
  }
  ctx.fillStyle = o.color
  lines.forEach((l, i) => ctx.fillText(l, cx, cy - h / 2 + lh * (i + 0.5)))
  ctx.restore()
  return { x: cx - w / 2 - padX, y: cy - h / 2 - padY, w: w + padX * 2, h: h + padY * 2 }
}

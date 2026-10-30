/**
 * 動画に重ねるテキスト。
 * 位置・大きさは、絵（書き出す動画の 1 コマ）に対する割合で持つ（画面の大きさや、書き出しの画質が変わっても、同じ見た目になる）。
 * 時間は、動画（key）の中の秒で持つ。区間の分割・削除・動画の並べ替えをしても、テキストは、付けた場面に付いてくる。
 * 画面のプレビューと、書き出す画像は、同じ drawText で描く（見た目が、ずれないように）
 */

/**
 * はじめから並べる色：白・クリーム黄（おしゃれ系のタイトルで見られる、やわらかい黄）・黄・金茶・濃い茶（ラテアート・カフェの動画で、実際に多かった白を中心に、ラテ帳の温かい色）。
 * 動画の背景（ラテの茶・泡の白）の上で読めるよう、明るい色は、影・縁・板と組み合わせて使う。ほかの色は、システムのカラーピッカーで選ぶ
 */
export const TEXT_COLORS = ['#ffffff', '#f3e2a0', '#ffd84d', '#c99b66', '#3b2a1e'] as const

/** 背景の板の濃さ（0〜1）。動画が透けて見える程度 */
export const PLATE_ALPHA = 0.78

/** 縁取りの太さ（文字の大きさに対する、縁の外側の幅の割合）。細めの縁（太い縁は、バラエティの印象になる） */
export const STROKE_RATIO = 0.085

/**
 * スタイル（1 タップで、文字の色・縁取り・背景の板・影をまとめて決める）。
 * ラテアート・カフェの縦動画を調べた結果（PR の説明）：白の細め〜中くらいの字幕に、やわらかい影、が最も多い。
 * 太い縁取りは、見出しに少し。板は、小さな帯として、少し。
 */
export const TEXT_STYLES = [
  { id: 'caption', color: '#ffffff', stroke: null, plate: false, plateColor: '#2b1d14' },
  { id: 'cream', color: '#f3e2a0', stroke: null, plate: false, plateColor: '#2b1d14' },
  { id: 'outline', color: '#ffffff', stroke: '#2b1d14', plate: false, plateColor: '#2b1d14' },
  { id: 'accent', color: '#ffd84d', stroke: '#2b1d14', plate: false, plateColor: '#2b1d14' },
  { id: 'plate-dark', color: '#fff6e6', stroke: null, plate: true, plateColor: '#2b1d14' },
  { id: 'plate-cream', color: '#3b2a1e', stroke: null, plate: true, plateColor: '#fff3df' },
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
 * フォント：ゴシック（字幕）・丸ゴシック・明朝・手書き・セリフ・セリフ斜体・細字（大文字）の 7 種。
 * ゴシック・丸ゴシック・明朝は、iPhone・iPad 標準のヒラギノ。手書き（Yusei Magic）・セリフ（Playfair Display）・セリフ斜体・細字（Josefin Sans）は、同梱
 * （SIL OFL 1.1。public/fonts。使うときだけ読み込む）。セリフ・細字は、英数字だけのフォント（おしゃれなタイトル用）で、日本語は、後ろの候補（明朝・ゴシック）で描く
 * （英字はおしゃれに、日本語は落ち着いた明朝に、という見え方になる）。細字は、字間を広げ、英字を大文字にする。
 * プレビューも書き出しも、同じ WebView の canvas で描くので、同じ見た目になる
 */
export const TEXT_FONTS = [
  { id: 'gothic', scale: 1, family: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif', weight: 600, italic: false, tracking: 0, upper: false },
  { id: 'maru', scale: 1, family: '"Hiragino Maru Gothic ProN", "Zen Maru Gothic", "Hiragino Sans", system-ui, sans-serif', weight: 700, italic: false, tracking: 0, upper: false },
  { id: 'mincho', scale: 1, family: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif', weight: 600, italic: false, tracking: 0, upper: false },
  { id: 'hand', scale: 1, family: '"Yusei Magic", "Hiragino Maru Gothic ProN", system-ui, sans-serif', weight: 400, italic: false, tracking: 0, upper: false },
  { id: 'serif', scale: 1.08, family: '"Playfair Display", "Hiragino Mincho ProN", "Yu Mincho", serif', weight: 600, italic: false, tracking: -0.02, upper: false },
  { id: 'serifi', scale: 1.08, family: '"Playfair Display", "Hiragino Mincho ProN", "Yu Mincho", serif', weight: 500, italic: true, tracking: -0.01, upper: false },
  { id: 'wide', scale: 0.68, family: '"Josefin Sans", "Hiragino Sans", "Hiragino Kaku Gothic ProN", system-ui, sans-serif', weight: 400, italic: false, tracking: 0.24, upper: true },
] as const

export type TextFontId = (typeof TEXT_FONTS)[number]['id']

const fontOf = (id: TextFontId) => TEXT_FONTS.find((f) => f.id === id) ?? TEXT_FONTS[0]

/** canvas の font 指定（斜体・太さ・大きさ・フォント） */
export function fontCss(id: TextFontId, px: number): string {
  const f = fontOf(id)
  return `${f.italic ? 'italic ' : ''}${f.weight} ${px}px ${f.family}`
}

/** 同梱のフォントは、使う前に読み込む（canvas は、読み込み中のフォントで描くと、代わりの字で描いてしまう） */
export async function loadTextFonts(ids: TextFontId[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  await Promise.all([...new Set(ids)].map((id) => document.fonts.load(fontCss(id, 40), 'あいうAa').catch(() => [])))
}

/** 文字の大きさ（絵の高さに対する割合）の範囲と、はじめの値 */
export const TEXT_SIZE_MIN = 0.03
export const TEXT_SIZE_MAX = 0.12
export const TEXT_SIZE_DEFAULT = 0.048

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
  return { id: newTextId(), key, start, end: start + len, text: '', x: 0.5, y: 0.8, size: TEXT_SIZE_DEFAULT, color: '#ffffff', stroke: null, font: 'gothic', plate: false, plateColor: '#2b1d14' }
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
    // 英単語は、1 つのまとまりとして、単語の途中では折らない（日本語は、1 文字ずつ）。単語が 1 行に入らなければ、文字で折る
    const units = para.match(/[A-Za-z0-9'’.,!?&:;()-]+|\s+|[\s\S]/gu) ?? ['']
    let cur = ''
    for (const u of units) {
      if (measure(cur + u) <= maxWidth) {
        cur += u
        continue
      }
      if (/^\s+$/.test(u)) continue
      if (cur) lines.push(cur.trimEnd())
      cur = ''
      if (measure(u) <= maxWidth) {
        cur = u
        continue
      }
      // 1 行に入らない長い単語は、文字で折る
      for (const ch of Array.from(u)) {
        if (cur && measure(cur + ch) > maxWidth) {
          lines.push(cur)
          cur = ch
        } else cur += ch
      }
    }
    lines.push(cur.trimEnd())
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
/** 1 行の幅（字間 tracking を足す。字ごとに測る） */
function lineWidth(ctx: CanvasRenderingContext2D, line: string, px: number, tracking: number): number {
  if (tracking === 0) return ctx.measureText(line).width
  const chars = Array.from(line)
  return chars.reduce((n, c) => n + ctx.measureText(c).width, 0) + tracking * px * Math.max(0, chars.length - 1)
}

/** 1 行を、中央そろえで描く（字間があるときは、字ごとに、左から並べる） */
function drawLine(ctx: CanvasRenderingContext2D, line: string, cx: number, y: number, px: number, tracking: number, stroke: boolean) {
  if (tracking === 0) {
    if (stroke) ctx.strokeText(line, cx, y)
    else ctx.fillText(line, cx, y)
    return
  }
  const chars = Array.from(line)
  let x = cx - lineWidth(ctx, line, px, tracking) / 2
  ctx.textAlign = 'left'
  for (const c of chars) {
    if (stroke) ctx.strokeText(c, x, y)
    else ctx.fillText(c, x, y)
    x += ctx.measureText(c).width + tracking * px
  }
  ctx.textAlign = 'center'
}

export function drawText(ctx: CanvasRenderingContext2D, W: number, H: number, o: TextOverlay): TextBox | undefined {
  if (!o.text.trim()) return undefined
  const font = fontOf(o.font)
  // 細字（大文字）は、字が横に長いので、同じ「大きさ」でも、小さく描く（ほかのフォントと、同じくらいの幅になる）
  const px = o.size * H * font.scale
  ctx.save()
  ctx.font = fontCss(o.font, px)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = font.upper ? o.text.toUpperCase() : o.text
  const lines = wrapLines(text, W * WRAP_WIDTH, (s) => lineWidth(ctx, s, px, font.tracking))
  const lh = px * 1.3
  const w = Math.max(...lines.map((l) => lineWidth(ctx, l, px, font.tracking)))
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
    // やわらかい影（二重に描いて、白い泡の上でも、字の輪郭が分かる程度に）
    ctx.shadowColor = isLight(o.color) ? 'rgba(20,10,0,0.62)' : 'rgba(255,255,255,0.7)'
    ctx.shadowBlur = px * 0.26
    ctx.shadowOffsetY = px * 0.05
    ctx.fillStyle = o.color
    // 3 回重ねて、影を濃くする（細い字でも、泡の白い所の上で、輪郭が出るように）
    for (let k = 0; k < 2; k++) lines.forEach((l, i) => drawLine(ctx, l, cx, cy - h / 2 + lh * (i + 0.5), px, font.tracking, false))
  }
  if (o.stroke) {
    // 縁取り：太い線を先に引いて、その上に文字を重ねる（外側にだけ縁が出る）。角は丸める
    ctx.lineJoin = 'round'
    ctx.lineWidth = px * STROKE_RATIO * 2
    ctx.strokeStyle = o.stroke
    lines.forEach((l, i) => drawLine(ctx, l, cx, cy - h / 2 + lh * (i + 0.5), px, font.tracking, true))
  }
  ctx.fillStyle = o.color
  lines.forEach((l, i) => drawLine(ctx, l, cx, cy - h / 2 + lh * (i + 0.5), px, font.tracking, false))
  ctx.restore()
  return { x: cx - w / 2 - padX, y: cy - h / 2 - padY, w: w + padX * 2, h: h + padY * 2 }
}

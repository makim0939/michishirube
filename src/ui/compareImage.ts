import { inMemory } from '../data/mediaPrep'

/**
 * 見比べた2杯を1枚の画像にする（SNS や友だちに送る用）。
 * 左右に正方形の写真を並べ、型の名前・日付・何日たったかを添える
 */

export interface CompareSide {
  /** 写真、または動画のサムネイル */
  blob: Blob
  /** 「最新 2026/10/12」など */
  label: string
}

const WIDTH = 1200
const MARGIN = 32
const GAP = 16
const SIDE = (WIDTH - MARGIN * 2 - GAP) / 2
const TOP = 112
const HEIGHT = TOP + SIDE + 96
const FONT = '-apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif'

async function load(blob: Blob): Promise<ImageBitmap> {
  // iPhone は端末の保存場所（IndexedDB）にある画像をそのまま読めないことがあるので、メモリに写してから読む
  return createImageBitmap(await inMemory(blob))
}

/** 正方形の枠いっぱいに、真ん中を切り取って描く */
function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, size: number) {
  const side = Math.min(img.width, img.height)
  const sx = (img.width - side) / 2
  const sy = (img.height - side) / 2
  ctx.save()
  ctx.beginPath()
  // 角丸が描けない古い iPhone（iOS 15 まで）では、四角のまま描く
  if ('roundRect' in ctx) ctx.roundRect(x, y, size, size, 24)
  else (ctx as CanvasRenderingContext2D).rect(x, y, size, size)
  ctx.clip()
  ctx.drawImage(img, sx, sy, side, side, x, y, size, size)
  ctx.restore()
}

export async function composeCompareImage(sides: [CompareSide, CompareSide], title: string, span: string): Promise<Blob> {
  const images = await Promise.all(sides.map((s) => load(s.blob)))
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#faf7f2'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  ctx.fillStyle = '#2b1d14'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `600 48px ${FONT}`
  // 長い名前でも、右の日数に重ならないように縮める
  ctx.fillText(title, MARGIN, 76, WIDTH - MARGIN * 2 - 280)
  ctx.font = `500 30px ${FONT}`
  ctx.fillStyle = '#8a6a4f'
  ctx.textAlign = 'right'
  ctx.fillText(span, WIDTH - MARGIN, 76)
  ctx.textAlign = 'left'

  images.forEach((img, i) => {
    const x = MARGIN + i * (SIDE + GAP)
    drawCover(ctx, img, x, TOP, SIDE)
    ctx.fillStyle = '#5c4636'
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(sides[i].label, x + 4, TOP + SIDE + 44)
    img.close()
  })

  ctx.fillStyle = '#b39a84'
  ctx.font = `500 24px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText('ラテ帳', WIDTH - MARGIN, HEIGHT - 24)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('画像を作れませんでした')
  return blob
}

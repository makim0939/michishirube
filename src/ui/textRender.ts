import { renderSize, type ComposeOverlay } from '../data/compose'
import { drawText, loadTextFonts, outputIntervals, type TextOverlay } from '../domain/textOverlay'

/**
 * 書き出しに重ねる、テキストの画像（透明な背景の PNG）を作る。
 * 書き出す絵と同じ大きさ（最初の区間の比・画質の短い辺）で、プレビューと同じ drawText で描く。
 * ranges は、できあがりに入る区間（つなぐ順）。外した区間にかかる部分は、できあがりの時間で途切れる
 */
export async function renderTextOverlays(
  texts: TextOverlay[],
  ranges: { key: string; start: number; end: number }[],
  first: { w: number; h: number },
  shortSide: number,
): Promise<ComposeOverlay[]> {
  const size = renderSize(first.w, first.h, shortSide)
  // 同梱のフォントは、読み込みが終わってから描く（終わる前だと、代わりの字になる）
  await loadTextFonts(texts.map((o) => o.font))
  const out: ComposeOverlay[] = []
  for (const o of texts) {
    const intervals = outputIntervals([o], ranges)
    if (intervals.length === 0) continue
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    drawText(ctx, size.width, size.height, o)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))
    for (const iv of intervals) out.push({ png, start: iv.start, end: iv.end })
  }
  return out
}

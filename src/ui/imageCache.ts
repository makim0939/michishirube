/**
 * 画面で使う写真の、読み込み済みの中身と表示用の URL の置き場（React に依存しない）。
 */

/**
 * 画面を開き直したとき（ホームに戻ったときなど）、読み込み済みの写真をすぐ出せるよう、読んだ中身と表示用の URL を覚えておく。
 * 覚えていないと、戻るたびに「枠だけ → 写真」と切り替わってちらつく。
 *
 * メモリにゴミが溜まらないよう、次のときに手放す。
 * - 上限を超えた（使われていない古いものから）。メモリの大きさは、おもにこの上限で守る
 * - 使われないまま IDLE_MS たった（長く開きっぱなしのときの片付け。設定を触っている間などに消えて、
 *   戻ったときにちらつかないよう、長めにする）
 * - 「すべて削除」（clearImageCaches）
 * 表示中のもの、直前に使われたもの（次の画面が拾ったばかりのもの）は手放さない
 */
const IDLE_MS = 30 * 60 * 1000
/** 直前に使われたものは、上限を超えていても手放さない（画面を切り替える最中に、拾ったものを手放さないため） */
const GRACE_MS = 5 * 1000
const CONTENT_MAX = 40
const URL_MAX = 60

const contentCache = new Map<string, { blob: Blob; usedAt: number }>()
/** 表示用の URL（Blob から作ったもの）。users は、いま使っている画面の数 */
const urlCache = new Map<string, { url: string; users: number; usedAt: number }>()

export function recallContent(key: string): Blob | undefined {
  const hit = contentCache.get(key)
  if (!hit) return undefined
  // 使うたびに、いちばん新しい位置へ（古いものから手放せるように）
  hit.usedAt = Date.now()
  contentCache.delete(key)
  contentCache.set(key, hit)
  return hit.blob
}

export function rememberContent(key: string, blob: Blob) {
  contentCache.delete(key)
  contentCache.set(key, { blob, usedAt: Date.now() })
  scheduleSweep()
}

export function urlFor(key: string, blob: Blob): string {
  let entry = urlCache.get(key)
  if (entry) {
    entry.usedAt = Date.now()
    urlCache.delete(key)
  } else {
    entry = { url: URL.createObjectURL(blob), users: 0, usedAt: Date.now() }
  }
  urlCache.set(key, entry)
  scheduleSweep()
  return entry.url
}

/** 使われなくなったものを手放す */
function sweep() {
  const now = Date.now()
  let contents = contentCache.size
  for (const [key, entry] of contentCache) {
    const age = now - entry.usedAt
    if (age > IDLE_MS || (contents > CONTENT_MAX && age > GRACE_MS)) {
      contentCache.delete(key)
      contents--
    }
  }
  let urls = urlCache.size
  for (const [key, entry] of urlCache) {
    if (entry.users > 0) continue
    const age = now - entry.usedAt
    if (age > IDLE_MS || (urls > URL_MAX && age > GRACE_MS)) {
      URL.revokeObjectURL(entry.url)
      urlCache.delete(key)
      urls--
    }
  }
  sweeping = undefined
  if (contentCache.size > 0 || urlCache.size > 0) scheduleSweep()
}

let sweeping: ReturnType<typeof setTimeout> | undefined

/** 覚えているものがあるあいだ、30秒ごとに見直す（何も無ければ止まる） */
function scheduleSweep() {
  sweeping ??= setTimeout(sweep, 30 * 1000)
}

/** 覚えている写真を、すぐ全部手放す（「すべて削除」のとき。削除したはずの写真をメモリに残さない） */
export function clearImageCaches() {
  clearTimeout(sweeping)
  sweeping = undefined
  contentCache.clear()
  for (const [key, entry] of urlCache) {
    // 表示中のものは、その画面が閉じたあとの見直しで手放す
    if (entry.users > 0) continue
    URL.revokeObjectURL(entry.url)
    urlCache.delete(key)
  }
  if (urlCache.size > 0) scheduleSweep()
}

/** 表示中の URL を使っていると数える。画面が閉じたとき（戻り値を呼ぶ）に数えるのをやめる */
export function acquireUrl(key: string): (() => void) | undefined {
  const entry = urlCache.get(key)
  if (!entry) return undefined
  entry.users++
  return () => {
    entry.users--
    entry.usedAt = Date.now()
    scheduleSweep()
  }
}

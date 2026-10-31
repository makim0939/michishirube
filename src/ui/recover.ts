import { readStorage, writeStorage } from './storage'

const KEY = 'michishirube.lastRecoverReload'
/** この間隔より短く続けて、勝手に読み込み直さない（直らない不具合で、読み込み直しが止まらなくなるのを防ぐ） */
const MIN_INTERVAL_MS = 30_000

/**
 * 読み込み直す。直近で読み込み直していたら、何もせず false を返す。
 * 真っ白で止まるより、静かに1回だけやり直すほうがよいが、やり直しても直らないときに繰り返さない
 */
export function reloadOnce(now = Date.now()): boolean {
  const last = Number(readStorage('session', KEY) ?? 0)
  if (now - last < MIN_INTERVAL_MS) return false
  writeStorage('session', KEY, String(now))
  // 覚えておけない環境（保存が使えない）では、読み込み直しが止まらなくなるので、やらない
  if (readStorage('session', KEY) !== String(now)) return false
  window.location.reload()
  return true
}

/** デプロイで部品のファイル名が変わり、古い画面から新しい部品を読めなかったときのエラーか */
export function isChunkLoadError(e: unknown): boolean {
  const message = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(
    message,
  )
}

/** 部品の読み込みに失敗したら、静かに1回だけ読み込み直す */
export function watchChunkErrors() {
  // Vite が、動的 import の失敗で出す
  window.addEventListener('vite:preloadError', (e) => {
    // 読み込み直せないとき（直前にやったばかり）は、握りつぶさず、元の例外を画面の ErrorBoundary に渡す
    if (reloadOnce()) e.preventDefault()
  })
}

/**
 * localStorage / sessionStorage は、プライベートブラウズやサイトデータの制限で例外を投げることがある。
 * 覚えておけなくても動作は続けられる値だけを置くので、失敗は握りつぶす
 */
type Kind = 'local' | 'session'

function store(kind: Kind): Storage {
  return kind === 'local' ? window.localStorage : window.sessionStorage
}

export function readStorage(kind: Kind, key: string): string | undefined {
  try {
    return store(kind).getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

export function writeStorage(kind: Kind, key: string, value: string) {
  try {
    store(kind).setItem(key, value)
  } catch {
    // 覚えられなくても動作は続けられる
  }
}

export function removeStorage(kind: Kind, key: string) {
  try {
    store(kind).removeItem(key)
  } catch {
    // 同上
  }
}

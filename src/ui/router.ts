import { useEffect, useState, type MouseEvent } from 'react'

export type Route =
  | { name: 'today' }
  | { name: 'map'; domainId?: string }
  | { name: 'skill'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'new'; domainId: string }
  | { name: 'record'; skillId: string; recordId?: string }
  | { name: 'cup'; recordId: string }
  | { name: 'records' }
  | { name: 'settings'; section?: SettingsSection; notice?: string }

/** 設定の中の画面 */
export type SettingsSection = 'storage' | 'sync' | 'backup' | 'roadmaps' | 'data'
const SETTINGS_SECTIONS: readonly string[] = ['storage', 'sync', 'backup', 'roadmaps', 'data']

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    // 壊れた % エスケープは、そのまま使う（見つからない画面として扱われる）
    return part
  }
}

// GitHub Pages でもサーバー設定なしで動くよう、ハッシュでルーティングする
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode)
  switch (parts[0]) {
    case 'map':
      return { name: 'map', domainId: parts[1] }
    case 'skill':
      if (parts[1] && parts[2] === 'edit') return { name: 'edit', id: parts[1] }
      if (parts[1]) return { name: 'skill', id: parts[1] }
      break
    case 'domain':
      if (parts[1] && parts[2] === 'new-skill') return { name: 'new', domainId: parts[1] }
      break
    case 'record':
      // 保存した記録を直す：#/record/<skillId>/edit/<recordId>
      if (parts[1] && parts[2] === 'edit' && parts[3]) return { name: 'record', skillId: parts[1], recordId: parts[3] }
      if (parts[1]) return { name: 'record', skillId: parts[1] }
      break
    case 'records':
      return { name: 'records' }
    case 'cup':
      // 1杯（記録1件）の詳細：#/cup/<recordId>
      if (parts[1]) return { name: 'cup', recordId: parts[1] }
      break
    case 'settings':
      // YouTube の連携から戻ってきたとき（#/settings/youtube-connected）は、同期の画面で結果を受け取る
      if (parts[1]?.startsWith('youtube-')) return { name: 'settings', section: 'sync', notice: parts[1] }
      if (parts[1] && SETTINGS_SECTIONS.includes(parts[1])) {
        return { name: 'settings', section: parts[1] as SettingsSection }
      }
      return { name: 'settings' }
  }
  return { name: 'today' }
}

export const href = (path: string) => `#${path}`

export function go(path: string) {
  window.location.hash = path
}

/** 履歴を積まずに移動する（保存・削除のあとに、戻るでフォームへ戻らないように） */
export function replace(path: string) {
  // 同じ画面への replace では hashchange が起きないので、印を立てない
  replacing = window.location.hash !== href(path)
  window.location.replace(href(path))
}

/**
 * いまの画面が、アプリを開いてから何画面目か（0 ならホーム画面・リンクから直接開いた画面で、戻る先がない）。
 * 履歴の項目ごとに覚えるので、戻る・進むで移動しても合う
 */
let inAppDepth = 0
/** replace で移動している（同じ深さのまま） */
let replacing = false

function storedDepth(): number | undefined {
  const depth = (window.history.state as { depth?: unknown } | null)?.depth
  return typeof depth === 'number' ? depth : undefined
}

function rememberDepth(depth: number) {
  inAppDepth = depth
  try {
    window.history.replaceState({ ...(window.history.state as object | null), depth }, '')
  } catch {
    // 覚えられなくても、移動はできる
  }
}

/** 来た画面へ戻る。アプリ内に履歴がなければ fallback へ */
export function goBack(fallback: string) {
  if (inAppDepth > 0) window.history.back()
  else go(fallback)
}

export function backHandler(fallback: string) {
  return (e: MouseEvent) => {
    e.preventDefault()
    goBack(fallback)
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    rememberDepth(storedDepth() ?? 0)
    const onChange = () => {
      // 戻る・進むで来た画面は、覚えておいた深さ。新しく積んだ画面は1つ深い（replace なら同じ深さ）
      const known = storedDepth()
      rememberDepth(known ?? (replacing ? inAppDepth : inAppDepth + 1))
      replacing = false
      setRoute(parseHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

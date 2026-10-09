import { useEffect, useState, type MouseEvent } from 'react'

export type Route =
  | { name: 'today' }
  | { name: 'map'; domainId?: string }
  | { name: 'skill'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'new'; domainId: string }
  | { name: 'record'; skillId: string }
  | { name: 'settings' }

// GitHub Pages でもサーバー設定なしで動くよう、ハッシュでルーティングする
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
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
      if (parts[1]) return { name: 'record', skillId: parts[1] }
      break
    case 'settings':
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
  window.location.replace(href(path))
}

// アプリ内で何回画面を移動したか。0 ならホーム画面から直接開いた直後なので、戻る先がない
let inAppDepth = 0

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
    const onChange = () => {
      // 読み込み後にアプリ内で移動していれば、1つ前の履歴はたいていアプリ内の画面
      inAppDepth += 1
      setRoute(parseHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

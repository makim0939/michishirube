import { useEffect, useState } from 'react'

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

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

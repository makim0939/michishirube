import { useEffect, useState } from 'react'
import { ensureSeeded } from './data/repo'
import { EditSkillScreen, NewSkillScreen } from './ui/EditSkillScreen'
import { FeedbackProvider } from './ui/feedback'
import { MapScreen } from './ui/MapScreen'
import { RecordScreen } from './ui/RecordScreen'
import { href, useRoute, type Route } from './ui/router'
import { SettingsScreen } from './ui/SettingsScreen'
import { SkillScreen } from './ui/SkillScreen'
import { TodayScreen } from './ui/TodayScreen'

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'today':
      return <TodayScreen />
    case 'map':
      return <MapScreen domainId={route.domainId} />
    case 'skill':
      return <SkillScreen key={route.id} id={route.id} />
    case 'edit':
      return <EditSkillScreen key={route.id} id={route.id} />
    case 'new':
      return <NewSkillScreen key={route.domainId} domainId={route.domainId} />
    case 'record':
      return <RecordScreen key={route.skillId} skillId={route.skillId} />
    case 'settings':
      return <SettingsScreen />
  }
}

const TABS = [
  { path: '/', label: '今日', icon: '🔥', match: (r: Route) => r.name === 'today' || r.name === 'record' },
  {
    path: '/map',
    label: 'ロードマップ',
    icon: '🗺️',
    match: (r: Route) => ['map', 'skill', 'edit', 'new'].includes(r.name),
  },
  { path: '/settings', label: '設定', icon: '⚙️', match: (r: Route) => r.name === 'settings' },
]

export function App() {
  const route = useRoute()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    ensureSeeded()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) {
    return (
      <div className="screen">
        <h1>データベースを開けませんでした</h1>
        <p>{error}</p>
        <p className="muted">プライベートブラウズでは保存できないことがあります。通常のウィンドウで開いてください。</p>
      </div>
    )
  }
  if (!ready) return null

  return (
    <FeedbackProvider>
      <main className="main">
        <Screen route={route} />
      </main>
      {route.name !== 'record' && (
        <nav className="tabbar">
          {TABS.map((t) => (
            <a key={t.path} href={href(t.path)} className={t.match(route) ? 'selected' : ''}>
              <span aria-hidden="true">{t.icon}</span>
              {t.label}
            </a>
          ))}
        </nav>
      )}
    </FeedbackProvider>
  )
}

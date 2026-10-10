import { useEffect, useState } from 'react'
import { ensureSeeded } from './data/repo'
import { startAutoSync } from './data/sync'
import { tidyVideos } from './data/tidy'
import { startAutoUpload } from './data/youtube'
import { formatBytes } from './ui/common'
import { CupIcon, LeafIcon, NotebookIcon, SlidersIcon } from './ui/icons'
import { EditSkillScreen, NewSkillScreen } from './ui/EditSkillScreen'
import { DebugOverlay } from './ui/DebugOverlay'
import { FeedbackProvider, useToast } from './ui/feedback'
import { MapScreen } from './ui/MapScreen'
import { RecordScreen } from './ui/RecordScreen'
import { RecordsScreen } from './ui/RecordsScreen'
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
      return (
        <RecordScreen
          key={`${route.skillId}-${route.recordId ?? ''}`}
          skillId={route.skillId}
          recordId={route.recordId}
          openCamera={route.camera}
        />
      )
    case 'records':
      return <RecordsScreen />
    case 'settings':
      return <SettingsScreen notice={route.notice} />
  }
}

/** 同期・YouTube へのアップ・古い動画の整理を、画面の裏で動かす */
function Background() {
  const toast = useToast()
  useEffect(() => {
    const stopSync = startAutoSync()
    const stopUpload = startAutoUpload()
    tidyVideos()
      .then(({ count, bytes }) => {
        if (count > 0) toast.show(`YouTube に上げ終えた古い動画 ${count} 本を端末から整理しました（${formatBytes(bytes)}）`)
      })
      .catch(() => {
        // 整理できなくても、次に開いたときにまた試す
      })
    return () => {
      stopSync()
      stopUpload()
    }
  }, [toast])
  return null
}

const TABS = [
  { path: '/', label: '今日', Icon: CupIcon, match: (r: Route) => r.name === 'today' || r.name === 'record' },
  { path: '/records', label: 'カップ帳', Icon: NotebookIcon, match: (r: Route) => r.name === 'records' },
  {
    path: '/map',
    label: '型',
    Icon: LeafIcon,
    match: (r: Route) => ['map', 'skill', 'edit', 'new'].includes(r.name),
  },
  { path: '/settings', label: '設定', Icon: SlidersIcon, match: (r: Route) => r.name === 'settings' },
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
      <DebugOverlay />
      <Background />
      <main className="main">
        <Screen route={route} />
      </main>
      {route.name !== 'record' && (
        <nav className="tabbar">
          {TABS.map((t) => (
            <a
              key={t.path}
              href={href(t.path)}
              className={t.match(route) ? 'selected' : ''}
              aria-current={t.match(route) ? 'page' : undefined}
            >
              <t.Icon size={24} />
              {t.label}
            </a>
          ))}
        </nav>
      )}
    </FeedbackProvider>
  )
}

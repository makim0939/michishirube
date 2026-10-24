import { useEffect, useState } from 'react'
import { moveContentsToFiles, optimizeVideos, tidyContentFiles, watchContentFiles } from './data/content'
import { initFiles } from './data/files'
import { ensureSeeded } from './data/repo'
import { restoreSnapshotIfEmpty, watchSnapshot } from './data/snapshot'
import { startAutoSync } from './data/sync'
import { tidyVideos } from './data/tidy'
import { startAutoUpload } from './data/youtube'
import { formatBytes } from './ui/common'
import { CupIcon, LeafIcon, NotebookIcon, SlidersIcon } from './ui/icons'
import { EditSkillScreen, NewSkillScreen } from './ui/EditSkillScreen'
import { CupScreen } from './ui/CupScreen'
import { DebugOverlay } from './ui/DebugOverlay'
import { FeedbackProvider, useToast } from './ui/feedback'
import { MapScreen } from './ui/MapScreen'
import { RecordScreen } from './ui/RecordScreen'
import { RecordsScreen } from './ui/RecordsScreen'
import { href, useRoute, type Route } from './ui/router'
import { SettingsScreen } from './ui/SettingsScreen'
import { SkillScreen } from './ui/SkillScreen'
import { TodayScreen } from './ui/TodayScreen'
import { t } from './i18n'

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
        />
      )
    case 'records':
      return <RecordsScreen />
    case 'cup':
      return <CupScreen key={route.recordId} recordId={route.recordId} />
    case 'settings':
      return <SettingsScreen key={route.section ?? 'top'} section={route.section} notice={route.notice} />
  }
}

/** 同期・YouTube へのアップ・YouTube に上げた動画の整理を、画面の裏で動かす */
function Background() {
  const toast = useToast()
  useEffect(() => {
    const stopSync = startAutoSync()
    const stopUpload = startAutoUpload()
    tidyVideos()
      .then(({ count, bytes }) => {
        if (count > 0) {
          toast.show(t.app.tidied(count, formatBytes(bytes)))
        }
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
  { path: '/', label: t.app.tabToday, Icon: CupIcon, match: (r: Route) => ['today', 'record', 'cup'].includes(r.name) },
  { path: '/records', label: t.app.tabRecords, Icon: NotebookIcon, match: (r: Route) => r.name === 'records' },
  {
    path: '/map',
    label: t.app.tabSkills,
    Icon: LeafIcon,
    match: (r: Route) => ['map', 'skill', 'edit', 'new'].includes(r.name),
  },
  { path: '/settings', label: t.app.tabSettings, Icon: SlidersIcon, match: (r: Route) => r.name === 'settings' },
]

export function App() {
  const route = useRoute()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    // アプリでは、ファイルの置き場所を用意し、画面の中の保存場所が消えていたら写しから戻してから始める
    initFiles()
      .then(() => restoreSnapshotIfEmpty())
      .then(() => ensureSeeded())
      .then(() => {
        watchContentFiles()
        watchSnapshot()
        // 画面の中の保存場所に残っている動画・写真があれば、ファイルへ移し、使われていないファイルを片付ける
        void moveContentsToFiles()
        void tidyContentFiles()
        // 大きな動画・日がたった高画質の動画を、設定の画質にそろえる
        void optimizeVideos()
        setReady(true)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) {
    return (
      <div className="screen">
        <h1>{t.app.dbOpenFailed}</h1>
        <p>{error}</p>
        <p className="muted">{t.app.dbOpenHint}</p>
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

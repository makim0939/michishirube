import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { estimateBackupSize, exportBackup, importBackup, type BackupPart } from '../data/backup'
import { db } from '../data/db'
import { contentFilesSize, resetContentFiles } from '../data/content'
import { saveSnapshotNow } from '../data/snapshot'
import { getSyncConfig, getSyncStatus } from '../data/sync'
import { TIDY_AFTER_DAYS } from '../data/tidy'
import { getVideoStorage, setVideoStorage, type VideoStorage } from '../data/videoStorage'
import { resumeUploads, youtubeStatus } from '../data/youtube'
import { ConfirmButton, formatBytes, requestPersist, saveFile } from './common'
import { useAction, useToast } from './feedback'
import { RoadmapSettings } from './RoadmapSettings'
import { backHandler, go, href, type SettingsSection } from './router'
import { SyncSettings } from './SyncSettings'
import { isNativeApp, SITE_URL } from '../platform'
import { AlertIcon, BackIcon, CheckIcon, ForwardIcon } from './icons'

function StorageStatus() {
  const [info, setInfo] = useState<{ usage?: number; quota?: number; persisted?: boolean }>()
  const refresh = async () => {
    const [estimate, persisted, files] = await Promise.all([
      navigator.storage?.estimate?.(),
      navigator.storage?.persisted?.(),
      contentFilesSize(),
    ])
    // アプリでは動画・写真がアプリのファイルにあるので、その分を足す。画面の保存場所の上限は関係ないので出さない
    setInfo({
      usage: estimate?.usage === undefined && !isNativeApp ? undefined : (estimate?.usage ?? 0) + files,
      quota: isNativeApp ? undefined : estimate?.quota,
      persisted,
    })
  }
  useEffect(() => {
    void refresh()
  }, [])
  if (!info) return null
  return (
    <div className="stack">
      {info.usage !== undefined && (
        <p>
          使用量 {formatBytes(info.usage)}
          {info.quota ? ` / 上限の目安 ${formatBytes(info.quota)}` : ''}
        </p>
      )}
      {/* ブラウザに保存を頼むのは Web 版だけ（アプリはアプリの保存場所を使う） */}
      {!isNativeApp && (
        <p className="status-line">
          {info.persisted ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
          {info.persisted
            ? '容量が足りなくなっても、ブラウザが自動で消さない設定になっています。'
            : '容量が足りなくなると、ブラウザが自動で消す可能性があります。'}
        </p>
      )}
      {!isNativeApp && !info.persisted && (
        <button
          className="btn small"
          onClick={async () => {
            await requestPersist()
            await refresh()
          }}
        >
          消さないようにブラウザへ頼む
        </button>
      )}
    </div>
  )
}

/**
 * プライバシーポリシー。アプリの中では、公開しているページを Safari で開く
 * （アプリに入れたファイルを別の窓で開くと、アプリの画面が置き換わってしまうため）
 */
const PRIVACY_URL = isNativeApp ? `${SITE_URL}privacy.html` : `${import.meta.env.BASE_URL}privacy.html`

const STORAGE_CHOICES: { value: VideoStorage; label: string }[] = [
  { value: 'device', label: 'この端末' },
  { value: 'youtube', label: 'YouTube' },
]

const TITLES: Record<SettingsSection, string> = {
  storage: '動画の保存先',
  sync: 'クラウド同期',
  backup: 'バックアップ',
  roadmaps: 'ロードマップ',
  data: 'データの削除',
}

/**
 * 設定。はじめは項目の一覧だけを出し、押すとその項目の画面を開く（iPhone の設定と同じ形。説明を1画面に並べない）
 */
export function SettingsScreen({ section, notice }: { section?: SettingsSection; notice?: string }) {
  if (!section) return <SettingsHome />
  return (
    <div className="screen">
      <header className="screen-header">
        <a className="back" href={href('/settings')} onClick={backHandler('/settings')} aria-label="設定に戻る">
          <BackIcon size={26} />
        </a>
        <h1>{TITLES[section]}</h1>
      </header>
      {section === 'storage' && <StoragePage />}
      {section === 'sync' && <SyncSettings notice={notice} />}
      {section === 'backup' && <BackupPage />}
      {section === 'roadmaps' && <RoadmapSettings />}
      {section === 'data' && <DataPage />}
    </div>
  )
}

function Row({ to, label, value, warn }: { to: SettingsSection; label: string; value?: ReactNode; warn?: boolean }) {
  return (
    <li>
      <a className="settings-row" href={href(`/settings/${to}`)}>
        <span className="settings-label">{label}</span>
        {value && <span className={`settings-value${warn ? ' warn' : ''}`}>{value}</span>}
        <ForwardIcon size={16} />
      </a>
    </li>
  )
}

function SettingsHome() {
  const data = useLiveQuery(async () => {
    const [storage, config, status, domains] = await Promise.all([
      getVideoStorage(),
      getSyncConfig(),
      getSyncStatus(),
      db.domains.count(),
    ])
    return { storage, config, status, domains }
  })
  if (!data) return null
  const sync = !data.config ? '使っていません' : data.status.error ? '同期できていません' : 'つながっています'
  return (
    <div className="screen">
      <header className="screen-header">
        <h1>設定</h1>
      </header>

      <section className="section">
        <h2>記録の保存</h2>
        <ul className="settings-list">
          <Row to="storage" label="動画の保存先" value={data.storage === 'device' ? 'この端末' : 'YouTube'} />
          <Row to="sync" label="クラウド同期" value={sync} warn={!!data.config && !!data.status.error} />
          <Row to="backup" label="バックアップ" />
        </ul>
      </section>

      <section className="section">
        <h2>型</h2>
        <ul className="settings-list">
          <Row to="roadmaps" label="ロードマップ" value={`${data.domains}つの分野`} />
        </ul>
      </section>

      <section className="section">
        <h2>その他</h2>
        <ul className="settings-list">
          <Row to="data" label="この端末のデータを削除" />
          <li>
            <a
              className="settings-row"
              href={PRIVACY_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="settings-label">プライバシーポリシー</span>
              <ForwardIcon size={16} />
            </a>
          </li>
        </ul>
      </section>

      <p className="muted small center">ラテ帳 v{__APP_VERSION__}</p>
    </div>
  )
}

function StoragePage() {
  const run = useAction()
  const toast = useToast()
  const storage = useLiveQuery(getVideoStorage)
  if (!storage) return null

  const changeStorage = async (value: VideoStorage) => {
    await setVideoStorage(value)
    if (value === 'youtube') {
      // 連携していなければ上げられないので、そのことを伝える（連携すると上げ始める）
      const connected = await youtubeStatus()
        .then((s) => !!s?.connected)
        .catch(() => false)
      if (connected) {
        toast.show('動画を YouTube に上げ始めます')
        void resumeUploads().catch(() => {})
      } else {
        toast.show('「クラウド同期」で YouTube と連携すると、動画を上げ始めます')
      }
    } else {
      toast.show('これから撮る動画は、この端末にだけ置きます')
    }
  }

  return (
    <>
      <section className="section">
        <div className="segmented">
          {STORAGE_CHOICES.map((c) => (
            <button
              key={c.value}
              type="button"
              className={storage === c.value ? 'selected' : ''}
              aria-pressed={storage === c.value}
              onClick={() => {
                if (storage !== c.value) run(() => changeStorage(c.value))
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {storage === 'device'
            ? '動画はこの端末にだけ置きます。30秒の動画100本で、約0.5GBです。'
            : `YouTube に限定公開で上げ、${TIDY_AFTER_DAYS}日たったら端末から消します。消えたあともアプリの中で見られますが、切り取りなどの編集はできません。YouTube との連携は「クラウド同期」から行います。`}
        </p>
      </section>
      <section className="section">
        <h2>端末の容量</h2>
        <StorageStatus />
      </section>
    </>
  )
}

function BackupPage() {
  const run = useAction()
  const toast = useToast()
  const restoreInput = useRef<HTMLInputElement>(null)
  const [pendingRestore, setPendingRestore] = useState<File[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  // 書き出しに時間がかかると、共有シートを開くのに必要な「直前のタップ」が切れる。
  // そのため、作り終えたら改めて「保存する」を押してもらう（分割されたときは1つずつ）
  const [exported, setExported] = useState<BackupPart[]>([])
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const data = useLiveQuery(async () => ({
    mediaSize: await estimateBackupSize(true),
    counts: { records: await db.records.count(), media: await db.media.count() },
  }))
  if (!data) return null

  const doExport = (includeMedia: boolean) =>
    run(async () => {
      setBusy(includeMedia ? 'full' : 'notes')
      try {
        setExported([])
        setSaved(new Set())
        setExported(await exportBackup({ includeMedia }))
      } finally {
        setBusy(null)
      }
    })

  return (
      <section className="section">
        <p className="muted">
          記録 {data.counts.records} 件・動画と写真 {data.counts.media} 件（{formatBytes(data.mediaSize)}）
        </p>
        <div className="stack">
          <button className="btn primary" disabled={busy !== null} onClick={() => doExport(true)}>
            {busy === 'full' ? '書き出し中…' : '動画・写真も含めて書き出す'}
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => doExport(false)}>
            {busy === 'notes' ? '書き出し中…' : '記録とロードマップだけ書き出す（軽い）'}
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => restoreInput.current?.click()}>
            バックアップから復元
          </button>
          <input
            ref={restoreInput}
            hidden
            type="file"
            accept="application/zip,.zip"
            multiple
            onChange={(e) => {
              setPendingRestore(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </div>
        {exported.length > 0 && (
          <div className="confirm">
            <p>
              バックアップを作りました
              {exported.length > 1 && `。大きいので ${exported.length} つの ZIP に分けています。復元するときは全部を選んでください`}
              。「ファイルに保存」や AirDrop で、この端末の外にも置いてください。
            </p>
            <div className="stack">
              {exported.map((part) => (
                <button
                  key={part.name}
                  className={saved.has(part.name) ? 'btn' : 'btn primary'}
                  onClick={() =>
                    run(async () => {
                      await saveFile(part.blob, part.name)
                      setSaved((prev) => new Set(prev).add(part.name))
                    })
                  }
                >
                  {saved.has(part.name) ? '✓ ' : ''}
                  {exported.length > 1 ? `${part.name.match(/(\d+)of\d+\.zip$/)?.[1]} つ目を保存` : '保存する'}（
                  {formatBytes(part.blob.size)}）
                </button>
              ))}
              <button className="btn ghost" onClick={() => setExported([])}>
                閉じる
              </button>
            </div>
          </div>
        )}
        {pendingRestore.length > 0 && (
          <div className="confirm">
            <p>
              {pendingRestore.length === 1 ? `「${pendingRestore[0].name}」` : `${pendingRestore.length} つの ZIP`}（
              {formatBytes(pendingRestore.reduce((sum, f) => sum + f.size, 0))}）で、
              <strong>いまのデータをすべて置き換えます。</strong>元に戻せません。
            </p>
            <div className="row">
              <button
                className="btn danger"
                disabled={busy !== null}
                onClick={() =>
                  run(async () => {
                    setBusy('restore')
                    try {
                      const s = await importBackup(pendingRestore)
                      setPendingRestore([])
                      toast.show(
                        `復元しました（型 ${s.skills}・記録 ${s.records}・動画と写真 ${s.media}）` +
                          (s.missingMedia > 0 ? `。含まれていなかった動画・写真 ${s.missingMedia} 件は外しました` : ''),
                      )
                      go('/')
                    } finally {
                      setBusy(null)
                    }
                  })
                }
              >
                {busy === 'restore' ? '復元中…' : '置き換える'}
              </button>
              <button className="btn" onClick={() => setPendingRestore([])}>
                やめる
              </button>
            </div>
          </div>
        )}
      </section>

  )
}

function DataPage() {
  const run = useAction()
  const toast = useToast()
  return (
      <section className="section">
        <p className="muted">この端末のロードマップ・記録・動画・写真・設定をすべて削除します。</p>
        <ConfirmButton
          className="btn ghost"
          confirmLabel="すべて削除する"
          message="この端末のロードマップ・記録・動画・写真・設定をすべて削除し、クラウド同期の接続も解除します。サーバーと YouTube のデータは消えないので、つなぎ直せば戻ります。"
          onConfirm={() =>
            run(async () => {
              await db.transaction('rw', [db.domains, db.skills, db.records, db.media, db.meta, db.outbox], async () => {
                await Promise.all([db.domains.clear(), db.skills.clear(), db.records.clear(), db.media.clear()])
                await Promise.all([db.meta.clear(), db.outbox.clear()])
                await db.meta.put({ key: 'seeded', value: true })
              })
              // アプリでは、動画・写真のファイルも消し、記録の写しも空にする（次に開いたときに戻らないように）
              await resetContentFiles()
              await saveSnapshotNow()
              toast.show('すべて削除しました')
              go('/')
            })
          }
        >
          削除する
        </ConfirmButton>
      </section>

  )
}

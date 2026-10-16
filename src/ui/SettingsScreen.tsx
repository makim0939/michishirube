import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { estimateBackupSize, exportBackup, importBackup, type BackupPart } from '../data/backup'
import { db } from '../data/db'
import { contentFilesSize, KEEP_HIGH_DAYS, optimizeVideos, resetContentFiles } from '../data/content'
import { saveSnapshotNow } from '../data/snapshot'
import { isLoggedIn, logout } from '../data/account'
import { getSyncConfig, getSyncStatus, runSync } from '../data/sync'
import { TIDY_AFTER_DAYS } from '../data/tidy'
import {
  getVideoSettings,
  setKeepHigh,
  setVideoQuality,
  setVideoStorage,
  setYoutubePrivacy,
  type VideoQuality,
  type VideoStorage,
  type YoutubePrivacy,
} from '../data/videoStorage'
import { megabytesPer30s } from '../data/mediaPrep'
import { isYoutubeConnected, resumeUploads } from '../data/youtube'
import { ConfirmButton, formatBytes, requestPersist, saveFile } from './common'
import { clearImageCaches } from './imageCache'
import { useAction, useToast } from './feedback'
import { RoadmapSettings } from './RoadmapSettings'
import { backHandler, go, href, type SettingsSection } from './router'
import { SyncSettings } from './SyncSettings'
import { forgetToday } from './TodayScreen'
import { isNativeApp, SITE_URL, YOUTUBE_TERMS_URL } from '../platform'
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
const PRIVACY_URL = isNativeApp ? `${SITE_URL}privacy` : `${import.meta.env.BASE_URL}privacy.html`


const TITLES: Record<SettingsSection, string> = {
  storage: '動画',
  sync: 'アカウント',
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
    const [video, config, status, domains] = await Promise.all([
      getVideoSettings(),
      getSyncConfig(),
      getSyncStatus(),
      db.domains.count(),
    ])
    return { video, config, status, domains }
  })
  if (!data) return null
  const loggedIn = isLoggedIn(data.config)
  const sync = !loggedIn ? 'ログインしていません' : data.status.error ? '同期できていません' : (data.config?.email ?? 'ログイン中')
  return (
    <div className="screen">
      <header className="screen-header">
        <h1>設定</h1>
      </header>

      <section className="section">
        <h2>記録の保存</h2>
        <ul className="settings-list">
          <Row
            to="storage"
            label="動画"
            value={`${data.video.storage === 'device' ? 'この端末' : 'YouTube'}・${data.video.quality === 'high' ? '高画質' : '標準'}`}
          />
          <Row to="sync" label="アカウント" value={sync} warn={loggedIn && !!data.status.error} />
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

/** 選ぶ項目の1行（iPhone の設定と同じく、選んでいる行に印を付ける） */
function Choice({
  label,
  sub,
  selected,
  onSelect,
}: {
  label: string
  sub: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <li role="none">
      <button type="button" className="settings-row choice" role="radio" aria-checked={selected} onClick={onSelect}>
        <span className="settings-label">
          {label}
          <span className="settings-sub">{sub}</span>
        </span>
        {selected && <CheckIcon size={18} />}
      </button>
    </li>
  )
}

/**
 * 保存先を YouTube にしたときの、連携の状態。連携するまでは上がらず、動画は端末に残る。
 * 連携はログインのあとの画面（アカウント）にあるので、どちらが足りないかと、そこへの行き方を出しておく
 */
function YoutubeLinkState() {
  const state = useLiveQuery(async () => ({
    loggedIn: isLoggedIn(await getSyncConfig()),
    connected: await isYoutubeConnected(),
  }))
  if (!state) return null
  if (state.connected) {
    return (
      <p className="status-line small">
        <CheckIcon size={16} />
        YouTube と連携しています。
      </p>
    )
  }
  return (
    <div className="stack">
      <p className="status-line small">
        <AlertIcon size={16} />
        {state.loggedIn ? 'YouTube との連携がまだです。' : 'ログインと YouTube との連携がまだです。'}
        連携するまで、動画は端末に置かれます。
      </p>
      <a className="btn small" href={href('/settings/sync')}>
        {state.loggedIn ? 'YouTube と連携する' : 'ログインして連携する'}
      </a>
    </div>
  )
}

/**
 * 動画の設定：保存先（この端末・YouTube）と画質（標準・高画質）。YouTube のときは公開範囲も。
 * 説明は各行の短い一言だけにし、選んだときの結果はトーストで知らせる
 */
function StoragePage() {
  const run = useAction()
  const toast = useToast()
  const settings = useLiveQuery(getVideoSettings)
  if (!settings) return null
  const { storage, quality, keepHigh, youtubePrivacy } = settings

  const changeStorage = async (value: VideoStorage) => {
    await setVideoStorage(value)
    if (value === 'youtube') {
      // 連携していなければ上げられないので、そのことを伝える（連携すると上げ始める）。
      // 連携の鍵はこの端末にあるので、通信せずに分かる（電波が無くても、連携済みを「未連携」と言わない）
      if (await isYoutubeConnected()) {
        toast.show('動画を YouTube に上げ始めます')
        void resumeUploads().catch(() => {})
      } else if (isLoggedIn(await getSyncConfig())) {
        toast.show('「アカウント」で YouTube と連携すると、動画を上げ始めます')
      } else {
        // YouTube の連携は、Google でログインしたあとの画面にある
        toast.show('YouTube に上げるには、「アカウント」でログインして、YouTube と連携してください')
      }
    } else {
      toast.show('これから撮る動画は、この端末にだけ置きます')
    }
    void optimizeVideos()
  }

  const changeQuality = async (value: VideoQuality) => {
    await setVideoQuality(value)
    toast.show(value === 'high' ? 'これから撮る動画は高画質になります' : 'これから撮る動画は標準の画質になります')
    void optimizeVideos()
  }

  const changeKeepHigh = async (value: boolean) => {
    await setKeepHigh(value)
    toast.show(value ? '高画質の動画を、そのまま残します' : `${KEEP_HIGH_DAYS}日たった高画質の動画を、標準に軽くします`)
    void optimizeVideos()
  }

  const changePrivacy = async (value: YoutubePrivacy) => {
    await setYoutubePrivacy(value)
    toast.show(value === 'public' ? 'これから上げる動画は、だれでも見られます' : 'これから上げる動画は、限定公開になります')
  }

  const select = (fn: () => Promise<void>) => () => run(fn)

  return (
    <>
      <section className="section">
        <h2>保存先</h2>
        <ul className="settings-list" role="radiogroup" aria-label="保存先">
          <Choice
            label="この端末"
            sub="端末にだけ置きます"
            selected={storage === 'device'}
            onSelect={select(() => (storage === 'device' ? Promise.resolve() : changeStorage('device')))}
          />
          <Choice
            label="YouTube"
            sub={`上げて${TIDY_AFTER_DAYS}日たったら端末から消します。端末の容量をほとんど使いません`}
            selected={storage === 'youtube'}
            onSelect={select(() => (storage === 'youtube' ? Promise.resolve() : changeStorage('youtube')))}
          />
        </ul>
        <p className="muted small">
          YouTube に上げる動画は、
          <a href={YOUTUBE_TERMS_URL} target="_blank" rel="noopener noreferrer">
            YouTube 利用規約
          </a>
          に沿った内容であることを、あなたが確認したものとみなされます。
        </p>
        {storage === 'youtube' && <YoutubeLinkState />}
      </section>

      <section className="section">
        <h2>画質</h2>
        <ul className="settings-list" role="radiogroup" aria-label="画質">
          <Choice
            label="標準"
            sub={`720p・30秒で約${megabytesPer30s('standard')}MB（100杯で約${megabytesPer30s('standard') / 10}GB）`}
            selected={quality === 'standard'}
            onSelect={select(() => (quality === 'standard' ? Promise.resolve() : changeQuality('standard')))}
          />
          <Choice
            label="高画質"
            sub={`1080p・30秒で約${megabytesPer30s('high')}MB。SNS に出す人向け`}
            selected={quality === 'high'}
            onSelect={select(() => (quality === 'high' ? Promise.resolve() : changeQuality('high')))}
          />
        </ul>
        <p className="muted small">撮るときの画面で、その動画だけ変えることもできます</p>
        {/* 端末に置く高画質の動画は、撮ってすぐ（SNS に出すとき）だけ高画質にして、あとは軽くできる。軽くするのはアプリだけ */}
        {quality === 'high' && storage === 'device' && isNativeApp && (
          <ul className="settings-list">
            <li>
              <label className="settings-row">
                <span className="settings-label">
                  高画質のまま残す
                  <span className="settings-sub">
                    {keepHigh ? 'ずっと高画質で置きます' : `${KEEP_HIGH_DAYS}日たったら標準に軽くします（SNS には撮ってすぐ出せます）`}
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={keepHigh}
                  onChange={(e) => run(() => changeKeepHigh(e.target.checked))}
                />
              </label>
            </li>
          </ul>
        )}
      </section>

      {storage === 'youtube' && (
        <section className="section">
          <h2>YouTube の公開範囲</h2>
          <ul className="settings-list" role="radiogroup" aria-label="YouTube の公開範囲">
            <Choice
              label="限定公開"
              sub="URL を知っている人だけ見られます"
              selected={youtubePrivacy === 'unlisted'}
              onSelect={select(() => (youtubePrivacy === 'unlisted' ? Promise.resolve() : changePrivacy('unlisted')))}
            />
            <Choice
              label="公開"
              sub="だれでも見られ、検索にも出ます。練習を発信したい人向け"
              selected={youtubePrivacy === 'public'}
              onSelect={select(() => (youtubePrivacy === 'public' ? Promise.resolve() : changePrivacy('public')))}
            />
          </ul>
        </section>
      )}

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
          message="この端末のロードマップ・記録・動画・写真・設定をすべて削除し、ログインも解除します。サーバーの記録・写真と YouTube の動画は消えないので、ログインし直せば戻ります。この端末にだけある動画（YouTube に上げていないもの）と、まだ送れていない変更は戻りません。"
          onConfirm={() =>
            run(async () => {
              // 送っていない変更があれば、先に送っておく（電波が悪ければ、長くは待たない）
              await Promise.race([runSync().catch(() => {}), new Promise((r) => setTimeout(r, 5000))])
              // サーバーのログインも終える（端末の印を消すだけだと、トークンがサーバーで使えるまま残る）
              await logout()
              await db.transaction('rw', [db.domains, db.skills, db.records, db.media, db.meta, db.outbox], async () => {
                await Promise.all([db.domains.clear(), db.skills.clear(), db.records.clear(), db.media.clear()])
                await Promise.all([db.meta.clear(), db.outbox.clear()])
                await db.meta.put({ key: 'seeded', value: true })
              })
              // アプリでは、動画・写真のファイルも消し、記録の写しも空にする（次に開いたときに戻らないように）
              await resetContentFiles()
              await saveSnapshotNow()
              // 覚えているホームの内容と写真も捨てる（削除したはずのものを、メモリにも画面にも残さない）
              forgetToday()
              clearImageCaches()
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

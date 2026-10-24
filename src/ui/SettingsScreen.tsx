import { accountLabel } from '../data/accountLabel'
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
import { getVideoTemplates, isCustomTemplates } from '../data/videoText'
import { ConfirmButton, formatBytes, requestPersist, saveFile } from './common'
import { clearImageCaches } from './imageCache'
import { useAction, useToast } from './feedback'
import { FeedbackPage } from './FeedbackPage'
import { RoadmapSettings } from './RoadmapSettings'
import { backHandler, go, href, type SettingsSection } from './router'
import { SyncSettings } from './SyncSettings'
import { YoutubeSettings } from './YoutubeSettings'
import { YoutubeTextSettings } from './YoutubeTextSettings'
import { showYoutubeSection } from './youtubeSection'
import { forgetToday } from './TodayScreen'
import { APP_STORE_REVIEW_URL, isIosApp, isNativeApp, PRIVACY_URL } from '../platform'
import { AlertIcon, BackIcon, CheckIcon, ForwardIcon } from './icons'
import { getLangChoice, setLangChoice, t, type Lang } from '../i18n'

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
          {t.settings.usage(formatBytes(info.usage))}
          {info.quota ? t.settings.quota(formatBytes(info.quota)) : ''}
        </p>
      )}
      {/* ブラウザに保存を頼むのは Web 版だけ（アプリはアプリの保存場所を使う） */}
      {!isNativeApp && (
        <p className="status-line">
          {info.persisted ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
          {info.persisted
            ? t.settings.persisted
            : t.settings.notPersisted}
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
          {t.settings.askPersist}
        </button>
      )}
    </div>
  )
}


const TITLES: Record<SettingsSection, string> = {
  storage: t.settings.video,
  sync: t.settings.account,
  backup: t.settings.backup,
  roadmaps: t.settings.roadmaps,
  data: t.settings.dataTitle,
  feedback: t.settings.feedback,
  'video-text': t.settings.videoText,
  language: t.settings.language,
}

/**
 * 設定。はじめは項目の一覧だけを出し、押すとその項目の画面を開く（iPhone の設定と同じ形。説明を1画面に並べない）
 */
export function SettingsScreen({ section, notice }: { section?: SettingsSection; notice?: string }) {
  if (!section) return <SettingsHome />
  // 「タイトルと説明」は、動画の設定の中の画面なので、動画に戻る
  const back = section === 'video-text' ? '/settings/storage' : '/settings'
  return (
    <div className="screen">
      <header className="screen-header">
        <a className="back" href={href(back)} onClick={backHandler(back)} aria-label={section === 'video-text' ? t.settings.backToVideo : t.settings.backToSettings}>
          <BackIcon size={26} />
        </a>
        <h1>{TITLES[section]}</h1>
      </header>
      {section === 'storage' && <StoragePage />}
      {section === 'sync' && <SyncSettings notice={notice} />}
      {section === 'backup' && <BackupPage />}
      {section === 'roadmaps' && <RoadmapSettings />}
      {section === 'video-text' && <YoutubeTextSettings />}
      {section === 'data' && <DataPage />}
      {section === 'feedback' && <FeedbackPage />}
      {section === 'language' && <LanguagePage />}
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
  const sync = !loggedIn ? t.settings.notLoggedIn : data.status.error ? t.settings.syncFailed : accountLabel(data.config?.email)
  return (
    <div className="screen">
      <header className="screen-header">
        <h1>{t.settings.title}</h1>
      </header>

      <section className="section">
        <h2>{t.settings.saving}</h2>
        <ul className="settings-list">
          <Row
            to="storage"
            label={t.settings.video}
            value={`${data.video.storage === 'device' ? t.settings.thisDevice : 'YouTube'}${t.common.sep}${data.video.quality === 'high' ? t.settings.high : t.settings.standardQuality}`}
          />
          <Row to="sync" label={t.settings.account} value={sync} warn={loggedIn && !!data.status.error} />
          <Row to="backup" label={t.settings.backup} />
        </ul>
      </section>

      {/* ラテアート専用の間は、分野が重複したとき（2つ以上）だけ出す。重複した分野を消すための入口 */}
      {data.domains >= 2 && (
        <section className="section">
          <h2>{t.app.tabSkills}</h2>
          <ul className="settings-list">
            <Row to="roadmaps" label={t.settings.roadmaps} value={t.settings.domainCount(data.domains)} />
          </ul>
        </section>
      )}

      <section className="section">
        <h2>{t.settings.other}</h2>
        <ul className="settings-list">
          {/* アプリの言語は、端末の設定（アプリごとの言語）で変える。Web 版だけ、ここで選ぶ */}
          {!isNativeApp && (
            <Row to="language" label={t.settings.language} value={LANGUAGE_NAME[getLangChoice()]} />
          )}
          <Row to="feedback" label={t.settings.feedback} />
          {/* 評価の導線は、App Store があるアプリ（iPhone・iPad）だけ。出すのは設定の1行だけで、評価のお願いは出さない */}
          {isIosApp && (
            <li>
              <a className="settings-row" href={APP_STORE_REVIEW_URL} target="_blank" rel="noopener noreferrer">
                <span className="settings-label">{t.settings.rate}</span>
                <ForwardIcon size={16} />
              </a>
            </li>
          )}
          <Row to="data" label={t.settings.deleteData} />
          <li>
            <a
              className="settings-row"
              href={PRIVACY_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="settings-label">{t.settings.privacy}</span>
              <ForwardIcon size={16} />
            </a>
          </li>
        </ul>
      </section>

      <p className="muted small center">{t.settings.appName} v{__APP_VERSION__}</p>
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
  sub?: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <li role="none">
      <button type="button" className="settings-row choice" role="radio" aria-checked={selected} onClick={onSelect}>
        <span className="settings-label">
          {label}
          {sub && <span className="settings-sub">{sub}</span>}
        </span>
        {selected && <CheckIcon size={18} />}
      </button>
    </li>
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
  const connected = useLiveQuery(isYoutubeConnected)
  const templates = useLiveQuery(getVideoTemplates)
  if (!settings) return null
  const customTemplates = !!templates && isCustomTemplates(templates)
  const { storage, quality, keepHigh, youtubePrivacy } = settings

  const changeStorage = async (value: VideoStorage) => {
    await setVideoStorage(value)
    if (value === 'youtube') {
      // 連携していなければ上げられないので、そのことを伝える（連携すると上げ始める）。
      // 連携の鍵はこの端末にあるので、通信せずに分かる（電波が無くても、連携済みを「未連携」と言わない）
      if (await isYoutubeConnected()) {
        toast.show(t.settings.toastYoutubeStart)
        void resumeUploads().catch(() => {})
      } else if (isLoggedIn(await getSyncConfig())) {
        toast.show(t.settings.toastYoutubeConnect)
      } else {
        // YouTube とつなぐには、先にログインが要る（下に、ログインへのボタンを出す）
        toast.show(t.settings.toastYoutubeLogin)
      }
    } else {
      toast.show(t.settings.toastDevice)
    }
    void optimizeVideos()
  }

  const changeQuality = async (value: VideoQuality) => {
    await setVideoQuality(value)
    toast.show(value === 'high' ? t.settings.toastHigh : t.settings.toastStandard)
    void optimizeVideos()
  }

  const changeKeepHigh = async (value: boolean) => {
    await setKeepHigh(value)
    toast.show(value ? t.settings.toastKeepHigh : t.settings.toastShrink(KEEP_HIGH_DAYS))
    void optimizeVideos()
  }

  const changePrivacy = async (value: YoutubePrivacy) => {
    await setYoutubePrivacy(value)
    toast.show(value === 'public' ? t.settings.toastPublic : t.settings.toastUnlisted)
  }

  // いま選んでいる項目をもう一度押したときに、トーストや動画の作り直し（optimizeVideos）が走らないようにする
  const select =
    <T,>(current: T, value: T, change: (value: T) => Promise<void>) =>
    () =>
      run(() => (current === value ? Promise.resolve() : change(value)))

  return (
    <>
      <section className="section">
        <h2>{t.settings.storage}</h2>
        <ul className="settings-list" role="radiogroup" aria-label={t.settings.storage}>
          <Choice
            label={t.settings.thisDevice}
            sub={t.settings.thisDeviceSub}
            selected={storage === 'device'}
            onSelect={select(storage, 'device', changeStorage)}
          />
          <Choice
            label="YouTube"
            sub={t.settings.youtubeSub(TIDY_AFTER_DAYS)}
            selected={storage === 'youtube'}
            onSelect={select(storage, 'youtube', changeStorage)}
          />
        </ul>
        {/* YouTube に上げるときの、ログイン・つなぐ・利用規約の確認は、ここにまとめる */}
        {showYoutubeSection(storage, !!connected) && <YoutubeSettings />}
      </section>

      <section className="section">
        <h2>{t.settings.quality}</h2>
        <ul className="settings-list" role="radiogroup" aria-label={t.settings.quality}>
          <Choice
            label={t.settings.standard}
            sub={t.settings.standardSub(megabytesPer30s('standard'))}
            selected={quality === 'standard'}
            onSelect={select(quality, 'standard', changeQuality)}
          />
          <Choice
            label={t.settings.high}
            sub={t.settings.highSub(megabytesPer30s('high'))}
            selected={quality === 'high'}
            onSelect={select(quality, 'high', changeQuality)}
          />
        </ul>
        {/* 端末に置く高画質の動画は、撮ってすぐ（SNS に出すとき）だけ高画質にして、あとは軽くできる。軽くするのはアプリだけ */}
        {quality === 'high' && storage === 'device' && isNativeApp && (
          <ul className="settings-list">
            <li>
              <label className="settings-row">
                <span className="settings-label">
                  {t.settings.keepHigh}
                  <span className="settings-sub">
                    {keepHigh ? t.settings.keepHighOn : t.settings.keepHighOff(KEEP_HIGH_DAYS)}
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
          <h2>YouTube</h2>
          <ul className="settings-list" role="radiogroup" aria-label={t.settings.privacyLabel}>
            <Choice
              label={t.settings.unlisted}
              sub={t.settings.unlistedSub}
              selected={youtubePrivacy === 'unlisted'}
              onSelect={select(youtubePrivacy, 'unlisted', changePrivacy)}
            />
            <Choice
              label={t.settings.public}
              sub={t.settings.publicSub}
              selected={youtubePrivacy === 'public'}
              onSelect={select(youtubePrivacy, 'public', changePrivacy)}
            />
          </ul>
          <ul className="settings-list">
            <Row to="video-text" label={t.settings.videoText} value={customTemplates ? t.settings.custom : t.settings.standard} />
          </ul>
        </section>
      )}

      <section className="section">
        <h2>{t.settings.deviceStorage}</h2>
        <StorageStatus />
      </section>
    </>
  )
}

/** 言語の名前は、どの言語で表示していても、その言語自身の書き方で出す（読めない言語に迷い込んでも戻れるように） */
const LANGUAGE_NAME: Record<Lang | 'auto', string> = { auto: t.settings.languageAuto, ja: '日本語', en: 'English' }

/** 言語（Web 版だけ）。選ぶと読み込み直して切り替わる */
function LanguagePage() {
  const current = getLangChoice()
  return (
    <section className="section">
      <ul className="settings-list" role="radiogroup" aria-label={t.settings.language}>
        {(['auto', 'ja', 'en'] as const).map((choice) => (
          <Choice
            key={choice}
            label={LANGUAGE_NAME[choice]}
            sub={choice === 'auto' ? t.settings.languageAutoSub : undefined}
            selected={current === choice}
            onSelect={() => {
              if (choice !== current) setLangChoice(choice)
            }}
          />
        ))}
      </ul>
    </section>
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
        {t.settings.backupCounts(data.counts.records, data.counts.media, formatBytes(data.mediaSize))}
      </p>
      <div className="stack">
        <button className="btn primary" disabled={busy !== null} onClick={() => doExport(true)}>
          {busy === 'full' ? t.settings.exporting : t.settings.exportFull}
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => doExport(false)}>
          {busy === 'notes' ? t.settings.exporting : t.settings.exportNotes}
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => restoreInput.current?.click()}>
          {t.settings.restore}
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
            {t.settings.exported}
            {/* 保存先は、共有シートの選択肢（ファイル・ドライブなど）で選べるので、ここでは案内しない */}
            {exported.length > 1 && t.settings.exportedParts(exported.length)}
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
                {exported.length > 1 ? t.settings.savePart(part.name.match(/(\d+)of\d+\.zip$/)?.[1] ?? '') : t.common.save}
                {t.settings.paren(formatBytes(part.blob.size))}
              </button>
            ))}
            <button className="btn ghost" onClick={() => setExported([])}>
              {t.common.close}
            </button>
          </div>
        </div>
      )}
      {pendingRestore.length > 0 && (
        <div className="confirm">
          <p>
            {t.settings.restoreWith(
              pendingRestore.length === 1 ? pendingRestore[0].name : pendingRestore.length,
              formatBytes(pendingRestore.reduce((sum, f) => sum + f.size, 0)),
            )}
            <strong>{t.settings.restoreReplace}</strong>
            {t.settings.cannotUndo}
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
                    toast.show(t.settings.restored(s.skills, s.records, s.media, s.missingMedia))
                    go('/')
                  } finally {
                    setBusy(null)
                  }
                })
              }
            >
              {busy === 'restore' ? t.settings.restoring : t.settings.replace}
            </button>
            <button className="btn" onClick={() => setPendingRestore([])}>
              {t.common.cancel}
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
      <p className="muted">{t.settings.deleteAllNote}</p>
      <ConfirmButton
        className="btn ghost"
        confirmLabel={t.settings.deleteAll}
        message={t.settings.deleteAllConfirm}
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
            toast.show(t.settings.deletedAll)
            go('/')
          })
        }
      >
        {t.common.delete}
      </ConfirmButton>
    </section>
  )
}

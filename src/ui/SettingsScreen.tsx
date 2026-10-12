import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { estimateBackupSize, exportBackup, importBackup, type BackupPart } from '../data/backup'
import { db } from '../data/db'
import { BUNDLED_TEMPLATES, getSettings, importTemplate, setMaxActive } from '../data/repo'
import { TIDY_AFTER_DAYS } from '../data/tidy'
import { getVideoStorage, setVideoStorage, type VideoStorage } from '../data/videoStorage'
import { resumeUploads } from '../data/youtube'
import { MAX_ACTIVE_RANGE } from '../domain/types'
import { ConfirmButton, formatBytes, requestPersist, saveFile } from './common'
import { useAction, useToast } from './feedback'
import { go } from './router'
import { SyncSettings } from './SyncSettings'
import { AlertIcon, CheckIcon } from './icons'

function StorageStatus() {
  const [info, setInfo] = useState<{ usage?: number; quota?: number; persisted?: boolean }>()
  const refresh = async () => {
    const estimate = await navigator.storage?.estimate?.()
    const persisted = await navigator.storage?.persisted?.()
    setInfo({ usage: estimate?.usage, quota: estimate?.quota, persisted })
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
      <p className="status-line">
        {info.persisted ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
        {info.persisted
          ? '容量が足りなくなっても、ブラウザが自動で消さない設定になっています。'
          : '容量が足りなくなると、ブラウザが自動で消す可能性があります。'}
      </p>
      {!info.persisted && (
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

const STORAGE_CHOICES: { value: VideoStorage; label: string }[] = [
  { value: 'device', label: 'この端末' },
  { value: 'youtube', label: 'YouTube' },
]

export function SettingsScreen({ notice }: { notice?: string }) {
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
    settings: await getSettings(),
    storage: await getVideoStorage(),
    domainNames: (await db.domains.toArray()).map((d) => d.name),
    mediaSize: await estimateBackupSize(true),
    counts: { records: await db.records.count(), media: await db.media.count() },
  }))
  if (!data) return null

  const changeStorage = async (value: VideoStorage) => {
    await setVideoStorage(value)
    if (value === 'youtube') {
      toast.show('動画を YouTube に上げ始めます')
      // 連携していなければ何もしない（連携すると上げ始める）
      void resumeUploads().catch(() => {})
    } else {
      toast.show('これから撮る動画は、この端末にだけ置きます')
    }
  }

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
    <div className="screen">
      <header className="screen-header">
        <h1>設定</h1>
      </header>

      <SyncSettings notice={notice} />

      <section className="section">
        <h2>同時に練習できる数</h2>
        <p className="muted">全分野の合計です。少ないほど、1つあたりの練習が濃くなります。</p>
        <div className="stepper">
          <button
            className="btn"
            aria-label="減らす"
            disabled={data.settings.maxActive <= MAX_ACTIVE_RANGE.min}
            onClick={() => run(() => setMaxActive(data.settings.maxActive - 1))}
          >
            −
          </button>
          <span className="stepper-value">{data.settings.maxActive}</span>
          <button
            className="btn"
            aria-label="増やす"
            disabled={data.settings.maxActive >= MAX_ACTIVE_RANGE.max}
            onClick={() => run(() => setMaxActive(data.settings.maxActive + 1))}
          >
            ＋
          </button>
        </div>
        <p className="muted small">上限を下げても、すでに練習中の型は外れません。</p>
      </section>

      <section className="section">
        <h2>動画の保存先</h2>
        <div className="segmented">
          {STORAGE_CHOICES.map((c) => (
            <button
              key={c.value}
              type="button"
              className={data.storage === c.value ? 'selected' : ''}
              aria-pressed={data.storage === c.value}
              onClick={() => {
                if (data.storage !== c.value) run(() => changeStorage(c.value))
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {data.storage === 'device'
            ? '動画はこの端末にだけ置きます。30秒の動画100本で、約0.5GBです。'
            : `YouTube に限定公開で上げ、${TIDY_AFTER_DAYS}日たったら端末から消します。消えたあともアプリの中で見られますが、切り取りなどの編集はできません。`}
        </p>
        <StorageStatus />
      </section>

      <section className="section">
        <h2>バックアップ</h2>
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

      <section className="section">
        <h2>用意されているロードマップ</h2>
        <ul className="list">
          {BUNDLED_TEMPLATES.map((t) => (
            <li key={t.domain} className="list-row">
              <span className="list-main">
                <span>{t.domain}</span>
                <span className="list-sub">型 {t.skills.length}</span>
              </span>
              <button
                className="btn small"
                onClick={async () => {
                  const id = await run(() => importTemplate(t))
                  if (id) {
                    toast.show(
                      data.domainNames.includes(t.domain)
                        ? `「${t.domain}」をもう1つ追加しました`
                        : `「${t.domain}」を追加しました`,
                    )
                    go(`/map/${id}`)
                  }
                }}
              >
                追加
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>この端末のデータをすべて削除</h2>
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
              toast.show('すべて削除しました')
              go('/')
            })
          }
        >
          削除する
        </ConfirmButton>
      </section>

      <p className="muted small center">
        ラテ帳 v{__APP_VERSION__}・
        <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noopener noreferrer">
          プライバシーポリシー
        </a>
      </p>
    </div>
  )
}

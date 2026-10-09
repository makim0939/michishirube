import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { backupFileName, estimateBackupSize, exportBackup, importBackup } from '../data/backup'
import { db } from '../data/db'
import { BUNDLED_TEMPLATES, getSettings, importTemplate, setMaxActive } from '../data/repo'
import { MAX_ACTIVE_RANGE } from '../domain/types'
import { ConfirmButton, formatBytes, requestPersist, saveFile } from './common'
import { useAction, useToast } from './feedback'
import { go } from './router'

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
      <p>
        {info.persisted
          ? '✅ 容量が足りなくなっても、ブラウザが自動で消さない設定になっています。'
          : '⚠️ 容量が足りなくなると、ブラウザが自動で消す可能性があります。'}
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

export function SettingsScreen() {
  const run = useAction()
  const toast = useToast()
  const restoreInput = useRef<HTMLInputElement>(null)
  const [pendingRestore, setPendingRestore] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const data = useLiveQuery(async () => ({
    settings: await getSettings(),
    domainNames: (await db.domains.toArray()).map((d) => d.name),
    mediaSize: await estimateBackupSize(true),
    counts: { records: await db.records.count(), media: await db.media.count() },
  }))
  if (!data) return null

  const doExport = (includeMedia: boolean) =>
    run(async () => {
      setBusy(includeMedia ? 'full' : 'notes')
      try {
        const blob = await exportBackup({ includeMedia })
        await saveFile(blob, backupFileName(includeMedia))
      } finally {
        setBusy(null)
      }
    })

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>設定</h1>
      </header>

      <section className="section">
        <h2>同時に挑戦できる数</h2>
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
        <p className="muted small">上限を下げても、すでに挑戦中のスキルは外れません。</p>
      </section>

      <section className="section">
        <h2>データの保存場所</h2>
        <p>
          記録・動画・写真は<strong>この端末のこのブラウザの中だけ</strong>に保存され、サーバーには送られません。別の端末とは自動で同期されないので、機種変更や万一に備えてバックアップを書き出してください。
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
            onChange={(e) => {
              setPendingRestore(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </div>
        {pendingRestore && (
          <div className="confirm">
            <p>
              「{pendingRestore.name}」（{formatBytes(pendingRestore.size)}）で、
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
                      toast.show(
                        `復元しました（スキル ${s.skills}・記録 ${s.records}・動画と写真 ${s.media}）` +
                          (s.missingMedia > 0 ? `。含まれていなかった動画・写真 ${s.missingMedia} 件は外しました` : ''),
                      )
                      setPendingRestore(null)
                      go('/')
                    } finally {
                      setBusy(null)
                    }
                  })
                }
              >
                {busy === 'restore' ? '復元中…' : '置き換える'}
              </button>
              <button className="btn" onClick={() => setPendingRestore(null)}>
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
                <span className="list-sub">{t.skills.length} スキル・出典つき</span>
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
        <h2>すべてのデータを削除</h2>
        <ConfirmButton
          className="btn ghost"
          confirmLabel="すべて削除する"
          message="ロードマップ・記録・動画・写真・設定をすべて削除します。元に戻せません。"
          onConfirm={() =>
            run(async () => {
              await db.transaction('rw', [db.domains, db.skills, db.records, db.media, db.meta], async () => {
                await Promise.all([db.domains.clear(), db.skills.clear(), db.records.clear(), db.media.clear()])
                await db.meta.clear()
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

      <p className="muted small center">道しるべ v{__APP_VERSION__}</p>
    </div>
  )
}

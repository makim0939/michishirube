import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState } from 'react'
import { db } from '../data/db'
import { connectSync, disconnectSync, getSyncConfig, getSyncStatus, runSync } from '../data/sync'
import {
  disconnectYoutube,
  resumeUploads,
  startYoutubeAuth,
  youtubeStatus,
  type YoutubeStatus,
} from '../data/youtube'
import { ConfirmButton, formatAgo, formatDate } from './common'
import { useAction, useToast } from './feedback'
import { replace } from './router'

const SETUP_GUIDE = 'https://github.com/makim0939/michishirube/blob/main/docs/setup.md'

function ConnectForm() {
  const run = useAction()
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const result = await run(() => connectSync({ url, token }))
        setBusy(false)
        if (result) {
          toast.show(
            result.firstDevice ? 'この端末の記録をサーバーに送りました' : 'サーバーの記録を受け取りました',
          )
        }
      }}
    >
      <label className="field">
        <span>サーバーの URL</span>
        <input
          type="url"
          inputMode="url"
          required
          autoComplete="off"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://michishirube-api.〇〇.workers.dev"
        />
      </label>
      <label className="field">
        <span>トークン</span>
        <input
          type="password"
          required
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="サーバーに登録した APP_TOKEN"
        />
      </label>
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'つないでいます…' : 'つなぐ'}
      </button>
      <p className="muted small">
        サーバーの用意のしかたは
        <a href={SETUP_GUIDE} target="_blank" rel="noopener noreferrer">
          手順書
        </a>
        を見てください。2台目の端末では、サーバーの記録を受け取ります。
      </p>
    </form>
  )
}

function YoutubeSection({ notice }: { notice?: string }) {
  const run = useAction()
  const toast = useToast()
  const [status, setStatus] = useState<YoutubeStatus | null>()
  const pending = useLiveQuery(() => db.media.where('upload').anyOf('pending', 'uploading', 'failed').count(), [])

  const refresh = useCallback(() => {
    youtubeStatus()
      .then((s) => {
        setStatus(s ?? null)
        // 連携できていれば、止めていたアップロードをすぐ再開する
        if (s?.connected) void resumeUploads()
      })
      .catch(() => setStatus(null))
  }, [])

  // iPhone のホーム画面アプリでは、Google の画面が別のシートで開く。閉じて戻ってきたときに状態を取り直す
  useEffect(() => {
    refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  // Google の連携画面から戻ってきたとき
  useEffect(() => {
    if (!notice?.startsWith('youtube-')) return
    if (notice === 'youtube-connected') {
      toast.show('YouTube と連携しました')
      void resumeUploads()
    } else if (notice === 'youtube-failed') {
      toast.show('YouTube と連携できませんでした。もう一度試してください', 'error')
    }
    replace('/settings')
    refresh()
  }, [notice, toast, refresh])

  if (status === undefined) return <p className="muted small">確認しています…</p>
  if (status === null) return <p className="muted small">サーバーにつながりません。</p>
  if (!status.configured) {
    return (
      <p className="muted small">
        サーバーに Google の設定（GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET）がまだありません。
        <a href={SETUP_GUIDE} target="_blank" rel="noopener noreferrer">
          手順書
        </a>
        の「YouTube」を見てください。
      </p>
    )
  }
  return (
    <div className="stack">
      <p>
        {status.connected ? '✅ 連携しています。' : '⚠️ まだ連携していません。'}
        {!!pending && `アップ待ちの動画が ${pending} 本あります。`}
      </p>
      {status.connected ? (
        <div className="row wrap">
          {!!pending && (
            <button className="btn small" onClick={() => run(() => resumeUploads())}>
              今すぐアップ
            </button>
          )}
          <ConfirmButton
            className="btn small ghost"
            confirmLabel="解除する"
            message="YouTube との連携を解除します。上げた動画は YouTube に残ります。"
            onConfirm={() =>
              run(async () => {
                await disconnectYoutube()
                refresh()
              })
            }
          >
            連携を解除
          </ConfirmButton>
        </div>
      ) : (
        <button className="btn primary" onClick={() => run(() => startYoutubeAuth())}>
          Google でログインして連携
        </button>
      )}
      <p className="muted small">
        動画は保存のたびに、YouTube へ「非公開」で上げます（あなただけが YouTube アプリで見られます）。初回は「Google
        はこのアプリを確認していません」と出るので、「詳細」→「（安全ではないページ）に移動」で進んでください。
      </p>
    </div>
  )
}

export function SyncSettings({ notice }: { notice?: string }) {
  const run = useAction()
  const toast = useToast()
  const data = useLiveQuery(async () => ({
    config: await getSyncConfig(),
    status: await getSyncStatus(),
    pending: await db.outbox.count(),
  }))
  if (!data) return null
  const { config, status, pending } = data

  return (
    <>
      <section className="section">
        <h2>クラウド同期</h2>
        {config ? (
          <div className="stack">
            <p>
              {status.error ? `⚠️ ${status.error}` : '✅ つながっています。'}
              {status.lastSyncedAt && (
                <span className="muted">
                  {' '}
                  最後の同期：{formatAgo(status.lastSyncedAt)} {formatDate(status.lastSyncedAt).split(' ')[1]}
                </span>
              )}
            </p>
            {pending > 0 && <p className="muted small">送っていない変更が {pending} 件あります。</p>}
            <p className="muted small">接続先：{config.url}</p>
            <div className="row wrap">
              <button
                className="btn small"
                onClick={() =>
                  run(async () => {
                    await runSync()
                    toast.show('同期しました')
                  })
                }
              >
                今すぐ同期
              </button>
              <ConfirmButton
                className="btn small ghost"
                confirmLabel="解除する"
                message="この端末の同期を止めます。端末とサーバーの記録はどちらも残ります。"
                onConfirm={() => run(() => disconnectSync())}
              >
                接続を解除
              </ConfirmButton>
            </div>
          </div>
        ) : (
          <>
            <p className="muted">
              記録・ロードマップ・写真をサーバーにも保存し、スマホの容量が足りなくなって消えても戻せるようにします。PC
              とも同期できます。
            </p>
            <ConnectForm />
          </>
        )}
      </section>

      {config && (
        <section className="section">
          <h2>YouTube（動画の保存先）</h2>
          <YoutubeSection notice={notice} />
        </section>
      )}
    </>
  )
}

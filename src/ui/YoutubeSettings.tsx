import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState } from 'react'
import { isLoggedIn } from '../data/account'
import { db } from '../data/db'
import { getSyncConfig } from '../data/sync'
import { getVideoStorage } from '../data/videoStorage'
import { connectYoutube, disconnectYoutube, uploadNow, youtubeStatus, type YoutubeStatus } from '../data/youtube'
import { YOUTUBE_TERMS_URL } from '../platform'
import { ConfirmButton } from './common'
import { useAction, useToast } from './feedback'
import { AlertIcon, CheckIcon } from './icons'
import { href } from './router'
import { t } from '../i18n'

/**
 * 設定「動画」で保存先を YouTube にしたときの、YouTube とのつながり。
 * 保存先とつなぐ操作を、1つの画面（動画）にまとめる（「アカウント」は、ログインと同期だけ）。
 * YouTube とつなぐには、先にログインが要る（つなぐ鍵は、ログインしたアカウントでサーバーから受け取る）
 */
export function YoutubeSettings() {
  const loggedIn = useLiveQuery(async () => isLoggedIn(await getSyncConfig()))
  if (loggedIn === undefined) return null
  if (!loggedIn) {
    return (
      <div className="stack">
        <p className="status-line small">
          <AlertIcon size={16} />
          {t.youtube.needLogin}
        </p>
        <a className="btn small" href={href('/settings/sync')}>
          {t.youtube.login}
        </a>
      </div>
    )
  }
  return <YoutubeConnection />
}

function YoutubeConnection() {
  const run = useAction()
  const toast = useToast()
  const [status, setStatus] = useState<YoutubeStatus | null>()
  const [busy, setBusy] = useState(false)
  // 保存先が端末なら上げないので、アップ待ちも数えない
  const pending = useLiveQuery(async () =>
    (await getVideoStorage()) === 'youtube' ? db.media.where('upload').anyOf('pending', 'uploading', 'failed').count() : 0,
  )
  // Web 版でつないで戻ってきたとき・つながりが切れたときに、表示を取り直す
  const key = useLiveQuery(async () => !!(await db.meta.get('youtube:refresh')))

  const refresh = useCallback(() => {
    youtubeStatus()
      .then((s) => setStatus(s ?? null))
      .catch(() => setStatus(null))
  }, [])
  useEffect(refresh, [refresh, key])

  /** 押したら、上げた結果（まだ残っている本数と、止まっている理由）をトーストで知らせる */
  const uploadNowAndReport = async () => {
    setBusy(true)
    const left = await run(() => uploadNow())
    setBusy(false)
    if (!left) return
    const rest = left.waiting + left.failed
    if (rest === 0) toast.show(t.youtube.uploaded)
    else if (left.preparing > 0) toast.show(t.youtube.preparing(left.preparing))
    else toast.show(left.error ? t.youtube.restError(rest, left.error) : t.youtube.rest(rest), 'error')
  }

  if (status === undefined) return <p className="muted small">{t.youtube.checking}</p>
  if (status === null) return <p className="muted small">{t.youtube.statusFailed}</p>
  if (!status.configured) return <p className="muted small">{t.youtube.unavailable}</p>
  return (
    <div className="stack">
      <p className="status-line">
        {status.connected ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
        {status.connected ? t.youtube.isConnected : t.youtube.notConnected}
        {status.connected && !!pending && t.youtube.pending(pending)}
      </p>
      {status.connected ? (
        <div className="row wrap">
          {!!pending && (
            <button className="btn small" disabled={busy} onClick={uploadNowAndReport}>
              {busy ? t.youtube.uploading : t.youtube.uploadNow}
            </button>
          )}
          <ConfirmButton
            className="btn small ghost"
            confirmLabel={t.youtube.disconnectConfirm}
            message={t.youtube.disconnectMessage}
            onConfirm={() =>
              run(async () => {
                await disconnectYoutube()
                refresh()
              })
            }
          >
            {t.youtube.disconnect}
          </ConfirmButton>
        </div>
      ) : (
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const ok = await run(() => connectYoutube())
            setBusy(false)
            if (ok) toast.show(t.youtube.connected)
            refresh()
          }}
        >
          {busy ? t.youtube.connecting : t.youtube.connect}
        </button>
      )}
      {/* YouTube API の審査で求められた表示（利用規約に沿うことの確認・子ども向けではない）。つなぐボタンの下に残す */}
      <p className="muted small">
        {t.youtube.terms1}
        <a href={YOUTUBE_TERMS_URL} target="_blank" rel="noopener noreferrer">
          {t.youtube.terms}
        </a>
        {t.youtube.terms2}
      </p>
    </div>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState } from 'react'
import { isLoggedIn, rememberLoginReturn } from '../data/account'
import { db } from '../data/db'
import { getSyncConfig } from '../data/sync'
import { getVideoStorage } from '../data/videoStorage'
import { connectYoutube, disconnectYoutube, uploadNow, youtubeStatus, type YoutubeStatus } from '../data/youtube'
import { YOUTUBE_TERMS_URL } from '../platform'
import { ConfirmButton } from './common'
import { useAction, useToast } from './feedback'
import { AlertIcon, CheckIcon } from './icons'
import { go } from './router'

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
          YouTube に上げるには、ログインが必要です。
        </p>
        {/* ログインは「アカウント」の画面で行う。終わったら、ここ（動画）へ戻して、続けて YouTube とつなげるようにする */}
        <button
          className="btn small"
          onClick={async () => {
            // 覚えられなくても、ログインには進める（戻り先が無いだけ）
            await rememberLoginReturn('/settings/storage').catch(() => {})
            go('/settings/sync')
          }}
        >
          ログインする
        </button>
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
    if (rest === 0) toast.show('YouTube に上げました')
    else if (left.preparing > 0) toast.show(`画質をそろえています（${left.preparing} 本）。終わると自動で上げます`)
    else toast.show(left.error ? `まだ ${rest} 本残っています：${left.error}` : `まだ ${rest} 本残っています。しばらくしてからもう一度試してください`, 'error')
  }

  if (status === undefined) return <p className="muted small">確認しています…</p>
  if (status === null) return <p className="muted small">YouTube の状態を確かめられませんでした。</p>
  if (!status.configured) return <p className="muted small">いまは YouTube とつなげません。</p>
  return (
    <div className="stack">
      <p className="status-line">
        {status.connected ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
        {status.connected ? 'YouTube とつながっています。' : 'YouTube とまだつながっていません。つなぐまで、動画は端末に置きます。'}
        {status.connected && !!pending && `アップ待ちの動画が ${pending} 本あります。`}
      </p>
      {status.connected ? (
        <div className="row wrap">
          {!!pending && (
            <button className="btn small" disabled={busy} onClick={uploadNowAndReport}>
              {busy ? 'アップしています…' : '今すぐアップ'}
            </button>
          )}
          <ConfirmButton
            className="btn small ghost"
            confirmLabel="つながりを切る"
            message="この端末と YouTube のつながりをやめます。上げた動画は YouTube に残ります。"
            onConfirm={() =>
              run(async () => {
                await disconnectYoutube()
                refresh()
              })
            }
          >
            つなぐのをやめる
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
            if (ok) toast.show('YouTube とつなぎました')
            refresh()
          }}
        >
          {busy ? 'つないでいます…' : 'YouTube とつなぐ'}
        </button>
      )}
      {/* YouTube API の審査で求められた表示（利用規約に沿うことの確認・子ども向けではない）。つなぐボタンの下に残す */}
      <p className="muted small">
        YouTube に上げる動画は、
        <a href={YOUTUBE_TERMS_URL} target="_blank" rel="noopener noreferrer">
          YouTube 利用規約
        </a>
        に沿った内容であることを、あなたが確認したものとみなされます。動画は「子ども向けではない」として上げます。
      </p>
    </div>
  )
}

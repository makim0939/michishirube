import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  completeLogin,
  deleteAccount,
  isLoggedIn,
  isOurServer,
  loginWithGoogle,
  logout,
  resumeWebAuth,
} from '../data/account'
import { db } from '../data/db'
import { getSyncConfig, getSyncStatus, runSync } from '../data/sync'
import { getVideoStorage } from '../data/videoStorage'
import { connectYoutube, disconnectYoutube, saveYoutubeKey, uploadNow, youtubeStatus, type YoutubeStatus } from '../data/youtube'
import { formatDateTime } from '../domain/format'
import { ConfirmButton, formatAgo, formatBytes } from './common'
import { PHOTO_QUOTA_BYTES } from '../../shared/protocol'
import { useAction, useToast } from './feedback'
import { replace } from './router'
import { PRIVACY_URL, YOUTUBE_TERMS_URL } from '../platform'
import { AlertIcon, CheckIcon } from './icons'

/** ログインしたあとのトースト。アプリの中で終えたときと、Web 版で Google の画面から戻ったときで、同じ文言にする */
const loginMessage = (firstDevice: boolean) =>
  firstDevice ? 'ログインしました。この端末の記録をサーバーに置きました' : 'ログインしました。記録を受け取りました'

/** Web 版で、Google の画面から戻ってきたら結果を受け取る（戻り先の URL に一度きりのコードが付いてくる） */
function useWebAuthResult() {
  const toast = useToast()
  const run = useAction()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    void run(async () => {
      const result = await resumeWebAuth()
      if (!result) return
      if (result.kind === 'login') {
        const { firstDevice } = await completeLogin(result)
        toast.show(loginMessage(firstDevice))
      } else {
        await saveYoutubeKey(result.refreshToken)
        toast.show('YouTube と連携しました')
      }
    })
  }, [run, toast])
}

/** ログインしていないとき。何をサーバーに置くかを短く伝え、Google でログインしてもらう */
function LoginSection({ legacy }: { legacy: boolean }) {
  const run = useAction()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <section className="section">
      <div className="stack">
        <p>Google でログインすると、記録と写真をほかの端末でも使えます。機種を変えても、ログインすれば戻ります。</p>
        <p className="muted small">
          サーバーに置くのは、記録・型・写真（縮小したもの）だけです。動画は、この端末か YouTube に置きます。
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            くわしく
          </a>
        </p>
        {legacy && <p className="muted small">前の同期で置いた記録は、ログインすると引き継ぎます。</p>}
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const result = await run(() => loginWithGoogle())
            setBusy(false)
            if (result) {
              toast.show(loginMessage(result.firstDevice))
            }
          }}
        >
          {busy ? 'ログインしています…' : 'Google でログイン'}
        </button>
      </div>
    </section>
  )
}

function YoutubeSection() {
  const run = useAction()
  const toast = useToast()
  const [status, setStatus] = useState<YoutubeStatus | null>()
  const [busy, setBusy] = useState(false)
  // 保存先が端末なら上げないので、アップ待ちも数えない
  const pending = useLiveQuery(async () =>
    (await getVideoStorage()) === 'youtube' ? db.media.where('upload').anyOf('pending', 'uploading', 'failed').count() : 0,
  )
  // Web 版で連携して戻ってきたとき・連携が切れたときに、表示を取り直す
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
    else toast.show(left.error ? `まだ ${rest} 本残っています：${left.error}` : `まだ ${rest} 本残っています。電波を確かめて、もう一度試してください`, 'error')
  }

  if (status === undefined) return <p className="muted small">確認しています…</p>
  if (status === null) return <p className="muted small">サーバーにつながりません。</p>
  if (!status.configured) return <p className="muted small">サーバーに Google の設定がまだありません。</p>
  return (
    <div className="stack">
      <p className="status-line">
        {status.connected ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
        {status.connected ? 'この端末は連携しています。' : 'この端末は、まだ連携していません。'}
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
            confirmLabel="解除する"
            message="この端末の YouTube との連携を解除します。上げた動画は YouTube に残ります。"
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
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const ok = await run(() => connectYoutube())
            setBusy(false)
            if (ok) toast.show('YouTube と連携しました')
            refresh()
          }}
        >
          {busy ? '連携しています…' : 'YouTube と連携'}
        </button>
      )}
      <p className="muted small">
        設定の「動画」で保存先を YouTube にすると、動画をあなたの YouTube チャンネルに上げます（はじめは限定公開）。YouTube
        の鍵はこの端末にだけ置くので、ほかの端末ではその端末で連携してください。YouTube に上げる動画は、
        <a href={YOUTUBE_TERMS_URL} target="_blank" rel="noopener noreferrer">
          YouTube 利用規約
        </a>
        に沿った内容であることを、あなたが確認したものとみなされます。動画は「子ども向けではない」として上げます（変えるときは、YouTube で設定してください）。
      </p>
    </div>
  )
}

/** 設定の「アカウント」：Google でログインして、記録と写真をほかの端末でも使う。YouTube との連携もここで */
export function SyncSettings({ notice }: { notice?: string }) {
  const run = useAction()
  const toast = useToast()
  const data = useLiveQuery(async () => ({
    config: await getSyncConfig(),
    status: await getSyncStatus(),
    pending: await db.outbox.count(),
  }))
  useWebAuthResult()

  // 前の版の「YouTube と連携しました」の戻り先（#/settings/youtube-…）は、ここで受け止めて消す
  useEffect(() => {
    if (notice?.startsWith('youtube-')) replace('/settings/sync')
  }, [notice])

  if (!data) return null
  const { config, status, pending } = data
  const loggedIn = isLoggedIn(config)
  // 前の版で、同じサーバーに合言葉でつないでいた端末（ログインすると、そのデータを引き継ぐ）
  const legacy = !!config && !loggedIn && isOurServer(config.url)

  if (!config || !loggedIn) return <LoginSection legacy={legacy} />

  return (
    <>
      <section className="section">
        <h2>アカウント</h2>
        <div className="stack">
          <p className="status-line">
            {status.error ? <AlertIcon size={16} /> : <CheckIcon size={16} />}
            {config.email ?? 'Google アカウント'}
          </p>
          <p className="muted small">
            {status.error
              ? status.error
              : status.lastSyncedAt
                ? `最後の同期：${formatAgo(status.lastSyncedAt)} ${formatDateTime(status.lastSyncedAt).split(' ')[1]}`
                : '同期しています…'}
            {pending > 0 && `（送っていない変更が ${pending} 件）`}
          </p>
          {!!status.tooLarge && (
            <p className="muted small">
              大きすぎて送れない記録・型が {status.tooLarge} 件あります。メモや説明を短くすると送ります。
            </p>
          )}
          {status.photosFull && (
            <p className="muted small">
              サーバーに置ける写真の量（{formatBytes(PHOTO_QUOTA_BYTES)}）を超えたため、写真の一部をほかの端末に送れていません。いらない写真・記録を消すと、あとでまた送ります。
            </p>
          )}
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
              confirmLabel="ログアウトする"
              message="この端末のログインを終えます。端末の記録はそのまま残り、サーバーの記録も消えません。"
              onConfirm={() =>
                run(async () => {
                  await logout()
                  toast.show('ログアウトしました')
                })
              }
            >
              ログアウト
            </ConfirmButton>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>YouTube</h2>
        <YoutubeSection />
      </section>

      <section className="section danger-zone">
        <ConfirmButton
          className="btn ghost"
          confirmLabel="削除する"
          message="アカウントと、サーバーに置いた記録・写真をすべて削除します。元に戻せません。この端末の記録と、YouTube に上げた動画は残ります。"
          onConfirm={() =>
            run(async () => {
              toast.show(
                (await deleteAccount())
                  ? 'アカウントを削除しました'
                  : 'ログインが切れていたため、削除できたか確かめられませんでした。ほかの端末で削除していなければ、ログインし直してから削除してください',
              )
            })
          }
        >
          アカウントを削除
        </ConfirmButton>
      </section>
    </>
  )
}

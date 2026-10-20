import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  completeLogin,
  deleteAccount,
  isLoggedIn,
  isOurServer,
  loginWithApple,
  loginWithGoogle,
  logout,
  resumeWebAuth,
} from '../data/account'
import { db } from '../data/db'
import { getSyncConfig, getSyncStatus, runSync } from '../data/sync'
import { getVideoStorage } from '../data/videoStorage'
import { connectYoutube, disconnectYoutube, saveYoutubeKey, uploadNow, youtubeStatus, type YoutubeStatus } from '../data/youtube'
import { formatDateTime } from '../domain/format'
import { accountLabel } from '../data/accountLabel'
import { ConfirmButton, formatAgo, formatBytes } from './common'
import { PHOTO_QUOTA_BYTES } from '../../shared/protocol'
import { useAction, useToast } from './feedback'
import { replace } from './router'
import { isIosApp, PRIVACY_URL, YOUTUBE_TERMS_URL } from '../platform'
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
  // ログインの方法は、同じ働きで並べる（iOS では Apple も出す。Apple は、ほかのログインと同じ扱いの方法を用意することが条件）
  const login = async (method: () => Promise<{ firstDevice: boolean } | null>) => {
    setBusy(true)
    const result = await run(method)
    setBusy(false)
    if (result) toast.show(loginMessage(result.firstDevice))
  }
  return (
    <section className="section">
      <div className="stack">
        <p>ログインすると、記録と写真をほかの端末でも使えます。機種を変えても、ログインすれば戻ります。</p>
        <p className="muted small">
          サーバーに置くのは、記録・型・写真（縮小したもの）だけです。動画は、この端末か YouTube に置きます。
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            くわしく
          </a>
        </p>
        {legacy && <p className="muted small">前の同期で置いた記録は、ログインすると引き継ぎます。</p>}
        <div className="login-buttons">
          {isIosApp && (
            <button className="login-btn apple" disabled={busy} onClick={() => login(loginWithApple)}>
              {!busy && <AppleLogo />}
              {busy ? 'ログインしています…' : 'Apple でログイン'}
            </button>
          )}
          <button className="login-btn google" disabled={busy} onClick={() => login(loginWithGoogle)}>
            {!busy && <GoogleLogo />}
            {busy ? 'ログインしています…' : 'Google でログイン'}
          </button>
        </div>
      </div>
    </section>
  )
}

/** Apple の標準のロゴ（Sign in with Apple のボタンに付ける） */
function AppleLogo() {
  return (
    <svg className="login-btn-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" fill="currentColor" />
    </svg>
  )
}

/** Google 公式の「G」マーク（標準の4色。ブランドガイドラインで、色・形を変えないことが条件。白い背景の上に置く） */
function GoogleLogo() {
  return (
    <svg className="login-btn-logo" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
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
          className="btn"
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
      {/* YouTube API の審査で求められた表示（利用規約に沿うことの確認・子ども向けではない）。連携ボタンの下に残す */}
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
            {accountLabel(config.email)}
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

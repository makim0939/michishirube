import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
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
import { saveYoutubeKey } from '../data/youtube'
import { formatTime } from '../domain/format'
import { accountLabel } from '../data/accountLabel'
import { ConfirmButton, formatAgo, formatBytes } from './common'
import { PHOTO_QUOTA_BYTES } from '../../shared/protocol'
import { useAction, useToast } from './feedback'
import { replace } from './router'
import { isIosApp, PRIVACY_URL } from '../platform'
import { AlertIcon, CheckIcon } from './icons'
import { t } from '../i18n'

/** ログインしたあとのトースト。アプリの中で終えたときと、Web 版で Google の画面から戻ったときで、同じ文言にする */
const loginMessage = (firstDevice: boolean) =>
  firstDevice ? t.account.loggedInFirst : t.account.loggedIn

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
        toast.show(t.youtube.connected)
        // つなぐ操作は「動画」の画面にあるので、戻ってきたらそこへ（Web 版は、サーバーが同期の画面へ戻す）
        replace('/settings/storage')
      }
    })
  }, [run, toast])
}

/** ログインしていないとき。ログインの方法を並べる（何を保存するかは、プライバシーポリシーのリンクで） */
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
        <p>{t.account.intro}</p>
        {legacy && <p className="muted small">{t.account.legacy}</p>}
        <div className="login-buttons">
          {isIosApp && (
            <button className="login-btn apple" disabled={busy} onClick={() => login(loginWithApple)}>
              {!busy && <AppleLogo />}
              {busy ? t.account.signingIn : t.account.apple}
            </button>
          )}
          <button className="login-btn google" disabled={busy} onClick={() => login(loginWithGoogle)}>
            {!busy && <GoogleLogo />}
            {busy ? t.account.signingIn : t.account.google}
          </button>
        </div>
        <p className="muted small">
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            {t.settings.privacy}
          </a>
        </p>
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

/** 設定の「アカウント」：ログインして、記録と写真をほかの端末でも使う（YouTube とつなぐのは、設定の「動画」） */
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
    if (notice?.startsWith('youtube-')) replace('/settings/storage')
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
        <h2>{t.settings.account}</h2>
        <div className="stack">
          <p className="status-line">
            {status.error ? <AlertIcon size={16} /> : <CheckIcon size={16} />}
            {accountLabel(config.email)}
          </p>
          <p className="muted small">
            {status.error
              ? status.error
              : status.lastSyncedAt
                ? t.account.lastSync(`${formatAgo(status.lastSyncedAt)} ${formatTime(status.lastSyncedAt)}`)
                : t.account.syncing}
            {pending > 0 && t.account.pending(pending)}
          </p>
          {!!status.tooLarge && (
            <p className="muted small">
              {t.account.tooLarge(status.tooLarge)}
            </p>
          )}
          {status.photosFull && (
            <p className="muted small">
              {t.account.photosFull(formatBytes(PHOTO_QUOTA_BYTES))}
            </p>
          )}
          <div className="row wrap">
            <button
              className="btn small"
              onClick={() =>
                run(async () => {
                  await runSync()
                  toast.show(t.account.synced)
                })
              }
            >
              {t.account.syncNow}
            </button>
            <ConfirmButton
              className="btn small ghost"
              confirmLabel={t.account.logoutConfirm}
              message={t.account.logoutMessage}
              onConfirm={() =>
                run(async () => {
                  await logout()
                  toast.show(t.account.loggedOut)
                })
              }
            >
              {t.account.logout}
            </ConfirmButton>
          </div>
        </div>
      </section>

      <section className="section danger-zone">
        <ConfirmButton
          className="btn ghost"
          confirmLabel={t.common.delete}
          message={t.account.deleteMessage}
          onConfirm={() =>
            run(async () => {
              toast.show(
                (await deleteAccount())
                  ? t.account.deleted
                  : t.account.deleteUnknown,
              )
            })
          }
        >
          {t.account.delete}
        </ConfirmButton>
      </section>
    </>
  )
}

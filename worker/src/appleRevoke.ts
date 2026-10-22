/**
 * Sign in with Apple の「取り消し」を、ログイン・退会の流れに組み込む部分。
 * どちらも、Apple 側の失敗でログイン・退会を止めない（失敗はログに残すだけ）
 */
import { exchangeAppleCode, revokeAppleToken, type AppleKeyConfig } from './apple'
import { getAppleRefreshToken, setAppleRefreshToken } from './accounts'

type Deps = { fetchImpl?: typeof fetch }

/** ログインのとき：認可コードをリフレッシュトークンに替えて、その人の行に覚える */
export async function rememberAppleToken(
  db: D1Database,
  userId: string,
  appleSub: string,
  authorizationCode: unknown,
  config: AppleKeyConfig | null,
  deps: Deps = {},
): Promise<void> {
  if (!config || typeof authorizationCode !== 'string' || !authorizationCode) return
  try {
    const token = await exchangeAppleCode(config, authorizationCode, appleSub, deps.fetchImpl)
    if (token) await setAppleRefreshToken(db, userId, token)
    else console.error('apple code exchange: no token (refused, or the code belongs to another user)')
  } catch (e) {
    console.error('apple code exchange failed', e)
  }
}

/** 退会のとき：覚えているトークンで、Apple に取り消してもらう（データを消す前に呼ぶ） */
export async function revokeAppleForUser(db: D1Database, userId: string, config: AppleKeyConfig | null, deps: Deps = {}): Promise<void> {
  if (!config) return
  try {
    const token = await getAppleRefreshToken(db, userId)
    if (token && !(await revokeAppleToken(config, token, deps.fetchImpl))) console.error('apple revoke: refused by Apple')
  } catch (e) {
    console.error('apple revoke failed', e)
  }
}

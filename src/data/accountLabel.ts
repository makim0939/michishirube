import { t } from '../i18n'
/** Apple の「メールを隠す」で届く中継用のアドレス。見せても本人には意味がない */
const APPLE_RELAY = /@privaterelay\.appleid\.com$/i

/** アカウント画面の「ログイン中」の表示。メールが分かれば出し、Apple の中継用や、無いときは出さない */
export function accountLabel(email?: string): string {
  if (!email) return t.errors.signedIn
  if (APPLE_RELAY.test(email)) return t.errors.signedInApple
  return email
}

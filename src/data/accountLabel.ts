/** Apple の「メールを隠す」で届く中継用のアドレス。見せても本人には意味がない */
const APPLE_RELAY = /@privaterelay\.appleid\.com$/i

/** アカウント画面の「ログイン中」の表示。メールが分かれば出し、Apple の中継用や、無いときは出さない */
export function accountLabel(email?: string): string {
  if (!email) return 'ログイン中'
  if (APPLE_RELAY.test(email)) return 'Apple でログイン中'
  return email
}

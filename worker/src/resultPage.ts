/**
 * Google の画面から戻ってきたときに出すページ。
 * アプリでは、アプリが結果を問い合わせて自動でこの画面を閉じる（閉じなければ「完了」で閉じてもらう）。
 * Web 版は、ここから元の画面へ戻る。iPhone のホーム画面アプリから開いたときは別のシートで開くので、
 * 自動では移らず、閉じるかリンクで戻ってもらう（移るとホーム画面アプリとは別の保存場所で開いてしまう）
 */

export type ConnectResult = 'connected' | 'cancelled' | 'failed' | 'invalid'
export type ConnectKind = 'login' | 'youtube'

const TITLES: Record<ConnectKind, Record<ConnectResult, string>> = {
  login: {
    connected: 'ログインしました',
    cancelled: 'ログインをやめました',
    failed: 'ログインできませんでした',
    invalid: 'ログインを確認できませんでした',
  },
  youtube: {
    connected: 'YouTube と連携しました',
    cancelled: '連携をやめました',
    failed: '連携できませんでした',
    invalid: '連携を確認できませんでした',
  },
}

const BODIES: Record<ConnectResult, string> = {
  connected: 'ラテ帳に戻ります。戻らないときは、この画面を閉じてください。',
  cancelled: 'この画面を閉じて、ラテ帳に戻ってください。',
  failed: 'この画面を閉じて、ラテ帳の設定からもう一度試してください。',
  invalid: '時間が経ちすぎたか、別の画面から開かれました。ラテ帳の設定からもう一度始めてください。',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

export function resultPage(result: ConnectResult, kind: ConnectKind = 'youtube', returnTo?: string): string {
  const title = TITLES[kind][result]
  const back = returnTo
    ? `<p><a class="back" href="${escapeHtml(`${returnTo.split('#')[0]}#/settings/sync`)}">ラテ帳に戻る</a></p>`
    : ''
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}｜ラテ帳</title>
<style>
  :root { color-scheme: light; font-family: system-ui, -apple-system, 'Hiragino Sans', sans-serif; line-height: 1.7; }
  body { max-width: 480px; margin: 0 auto; padding: 64px 24px; background: #faf7f2; color: #2a1e17; text-align: center; }
  h1 { font-size: 1.25rem; font-weight: 600; }
  p { color: #7a6858; }
  .back { display: inline-block; margin-top: 8px; padding: 10px 20px; border: 1px solid #e6ddd1; border-radius: 999px; color: #2a1e17; text-decoration: none; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(BODIES[result])}</p>
${back}
</body>
</html>`
}

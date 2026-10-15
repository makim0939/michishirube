/**
 * Google の画面から戻ってきたときに出すページ。
 * 認可した画面（アプリの中のブラウザ・Web 版）を、始めたアプリ・Web 版へ戻す（成功したら一度きりのコードを付けて）。
 * 自動で移らないときのために、戻るボタンも出す
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
  connected: 'ラテ帳に戻ります。戻らないときは、下のボタンを押してください。',
  cancelled: 'ラテ帳に戻って、もう一度試してください。',
  failed: 'ラテ帳に戻って、設定からもう一度試してください。',
  invalid: '時間が経ちすぎたか、別の画面から開かれました。ラテ帳の設定からもう一度始めてください。',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

/** backUrl：ラテ帳（アプリ・Web 版）へ戻る URL。成功したときだけ、自動で移る */
export function resultPage(result: ConnectResult, kind: ConnectKind = 'youtube', backUrl?: string): string {
  const title = TITLES[kind][result]
  const back = backUrl ? `<p><a class="back" href="${escapeHtml(backUrl)}">ラテ帳に戻る</a></p>` : ''
  const auto =
    backUrl && result === 'connected' ? `<script>location.replace(${JSON.stringify(backUrl).replace(/</g, '\\u003c')})</script>` : ''
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="no-referrer">
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
${auto}
</body>
</html>`
}

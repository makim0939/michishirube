/**
 * Google の連携画面から戻ってきたときに出すページ。
 * iPhone のホーム画面アプリから連携すると Google の画面は別のシートで開き、そこでアプリへ飛ばすと
 * ホーム画面アプリとは別の保存場所でアプリが開いてしまう（同期が未設定に見える）。
 * そのため、ここではアプリへ飛ばさず「閉じて戻ってください」と案内する
 */

export type ConnectResult = 'connected' | 'cancelled' | 'failed' | 'invalid'

const MESSAGES: Record<ConnectResult, { title: string; body: string }> = {
  connected: {
    title: 'YouTube と連携しました',
    body: 'この画面を閉じて、道しるべに戻ってください。アップ待ちの動画が順に YouTube へ上がります。',
  },
  cancelled: {
    title: '連携をやめました',
    body: 'この画面を閉じて、道しるべに戻ってください。連携するときは、設定画面からもう一度始めてください。',
  },
  failed: {
    title: '連携できませんでした',
    body: 'この画面を閉じて、道しるべの設定画面からもう一度試してください。続けて失敗するときは、Google Cloud のクライアント ID・シークレットとリダイレクト URI を確認してください。',
  },
  invalid: {
    title: '連携を確認できませんでした',
    body: '時間が経ちすぎたか、別の画面から開かれました。道しるべの設定画面からもう一度始めてください。',
  },
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

export function resultPage(result: ConnectResult, returnTo?: string): string {
  const { title, body } = MESSAGES[result]
  const back = returnTo
    ? `<p class="small">PC など、同じ画面で開いている場合は <a href="${escapeHtml(`${returnTo.split('#')[0]}#/settings/youtube-${result}`)}">道しるべに戻る</a></p>`
    : ''
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}｜道しるべ</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, -apple-system, 'Hiragino Sans', sans-serif; line-height: 1.7; }
  body { max-width: 480px; margin: 0 auto; padding: 48px 20px; background: Canvas; color: CanvasText; text-align: center; }
  .icon { font-size: 3rem; }
  h1 { font-size: 1.3rem; }
  .hint { padding: 12px 14px; border-radius: 12px; background: color-mix(in srgb, CanvasText 8%, Canvas); text-align: left; }
  .small { font-size: 0.85rem; opacity: 0.75; }
</style>
</head>
<body>
<div class="icon" aria-hidden="true">${result === 'connected' ? '✅' : '⚠️'}</div>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<p class="hint">iPhone のホーム画面から開いた場合は、左上の「完了」（または ×）でこの画面を閉じると、道しるべに戻ります。</p>
${back}
</body>
</html>`
}

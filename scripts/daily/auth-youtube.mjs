// YouTube の更新トークンを、1 回だけ取って ~/.latte-daily/env に書く（docs/daily-growth.md）。
// 使い方：~/.latte-daily/env に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を書いてから、node scripts/daily/auth-youtube.mjs
// 表示された URL をブラウザで開いて、らておのチャンネルのアカウントで許可する。トークンは画面に出さない。
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const path = join(homedir(), '.latte-daily', 'env')
const env = {}
for (const line of existsSync(path) ? readFileSync(path, 'utf8').split('\n') : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
  console.error('~/.latte-daily/env に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を書いてください')
  process.exit(1)
}

const PORT = 8765
const redirect = `http://127.0.0.1:${PORT}/`
const state = randomBytes(16).toString('hex')
// 解析の読み取りと、動画の説明欄の更新（youtube.force-ssl）だけ。アップロード権限は要らない
const scope = ['https://www.googleapis.com/auth/yt-analytics.readonly', 'https://www.googleapis.com/auth/youtube.force-ssl'].join(' ')
const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state,
})}`
console.log('次の URL をブラウザで開いてください：\n' + url)

const server = createServer(async (req, res) => {
  const u = new URL(req.url, redirect)
  if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) {
    res.end('NG')
    return
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: u.searchParams.get('code'), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }),
  })
  const d = await r.json()
  if (!d.refresh_token) {
    res.end('refresh_token が取れませんでした')
    console.error('失敗：', d.error ?? 'refresh_token なし')
  } else {
    appendFileSync(path, `\nYT_REFRESH_TOKEN=${d.refresh_token}\n`)
    res.end('OK。このタブは閉じて構いません')
    console.log('YT_REFRESH_TOKEN を ~/.latte-daily/env に書きました')
  }
  server.close()
})
server.listen(PORT, '127.0.0.1')

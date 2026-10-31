// らておの動画の説明欄に、ラテ帳の案内ブロックを入れる・差し替える（docs/daily-growth.md）。
// 使い方：
//   node scripts/daily/yt-description.mjs list                       … 動画と、案内ブロックの有無
//   node scripts/daily/yt-description.mjs apply <動画ID> <本文ファイル>  … 案内ブロックを入れる（元の説明欄は ~/.latte-daily/backup/ に残す）
//   node scripts/daily/yt-description.mjs restore <動画ID>           … 最後のバックアップに戻す
// 案内ブロックは「▼ラテ帳」から「▲」までの部分だけを書き換え、それ以外の説明欄には触れない。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = join(homedir(), '.latte-daily')
const env = {}
for (const line of existsSync(join(HOME, 'env')) ? readFileSync(join(HOME, 'env'), 'utf8').split('\n') : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const START = '▼ラテ帳'
const END = '▲'

const token = async () => {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.YT_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  })
  const d = await r.json()
  if (!d.access_token) throw new Error('YouTube の鍵が使えない')
  return d.access_token
}
const api = async (t, path, init = {}) => {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } })
  if (!r.ok) throw new Error(`${r.status} ${path.split('?')[0]} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}
const block = (body) => `${START}\n${body.trim()}\n${END}`
const withBlock = (desc, body) => {
  const re = new RegExp(`${START}[\\s\\S]*?\\n${END}`)
  return re.test(desc) ? desc.replace(re, block(body)) : `${block(body)}\n\n${desc}`.trimEnd()
}

const [cmd, id, file] = process.argv.slice(2)
const t = await token()

if (cmd === 'list') {
  const ch = await api(t, 'channels?part=contentDetails&mine=true')
  const uploads = ch.items[0].contentDetails.relatedPlaylists.uploads
  const items = (await api(t, `playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}`)).items
  const vids = (await api(t, `videos?part=snippet,status&id=${items.map((i) => i.contentDetails.videoId).join(',')}`)).items
  for (const v of vids) console.log(JSON.stringify({ id: v.id, title: v.snippet.title, privacy: v.status.privacyStatus, hasBlock: v.snippet.description.includes(START) }))
} else if (cmd === 'apply' || cmd === 'restore') {
  const v = (await api(t, `videos?part=snippet&id=${id}`)).items?.[0]
  if (!v) throw new Error('動画が見つからない')
  // アプリから上がった練習の限定公開の動画には、触らない（公開の動画だけ）
  if (cmd === 'apply' && (await api(t, `videos?part=status&id=${id}`)).items[0].status.privacyStatus !== 'public') throw new Error('公開の動画だけが対象')
  mkdirSync(join(HOME, 'backup'), { recursive: true })
  let description
  if (cmd === 'apply') {
    writeFileSync(join(HOME, 'backup', `${id}-${Date.now()}.txt`), v.snippet.description)
    description = withBlock(v.snippet.description, readFileSync(file, 'utf8'))
  } else {
    const last = readdirSync(join(HOME, 'backup')).filter((f) => f.startsWith(`${id}-`)).sort().pop()
    if (!last) throw new Error('バックアップがない')
    description = readFileSync(join(HOME, 'backup', last), 'utf8')
  }
  // videos.update は、snippet を丸ごと送る（title と categoryId が必須）
  const s = v.snippet
  await api(t, 'videos?part=snippet', { method: 'PUT', body: JSON.stringify({ id, snippet: { title: s.title, categoryId: s.categoryId, description, tags: s.tags, defaultLanguage: s.defaultLanguage } }) })
  console.log(`${cmd} 済み：${id}`)
} else {
  console.error('list | apply <動画ID> <本文ファイル> | restore <動画ID>')
  process.exit(1)
}

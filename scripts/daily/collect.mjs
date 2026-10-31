// 毎日のアナリティクスを集めて、~/.latte-daily/data/YYYY-MM-DD.json に書く（docs/daily-growth.md）。
// 使い方：node scripts/daily/collect.mjs [YYYY-MM-DD]   （日付を省くと、きょう）
// 秘密の値は ~/.latte-daily/env に置く（git に入れない）。取れなかった元は、errors に理由を残して、ほかを続ける。
// 依存は Node 標準だけ。
import { createPrivateKey, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const HOME = join(homedir(), '.latte-daily')
const APP_ID = '6823908010'
const ZONE_ID = '21a06f7cb8388b1c8db3c8bd372d0c1e'
const HOST = 'latte.makimura.me'
const YT_CHANNEL = 'UCSMlEoN2vgFW7cjycBnHO9g'

const readEnv = () => {
  const path = join(HOME, 'env')
  const env = { ...process.env }
  if (!existsSync(path)) return env
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}
const env = readEnv()

const today = process.argv[2] ?? new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD（端末の日付）
const addDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10)
const since = addDays(today, -13) // 14 日分（推移を見るため）

const out = { date: today, since, errors: {} }
const attempt = async (name, fn) => {
  try {
    out[name] = await fn()
  } catch (e) {
    out.errors[name] = String(e?.message ?? e)
  }
}

const json = async (url, init) => {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : {}
}

// ---- Cloudflare：サイトの訪問（wrangler のログインを借りる。wrangler が、期限切れの鍵を更新する）
const cloudflare = async () => {
  try {
    execFileSync('npx', ['--yes', 'wrangler', 'whoami'], { cwd: 'worker', stdio: 'ignore', timeout: 120000 })
  } catch {}
  const cfg = join(homedir(), 'Library/Preferences/.wrangler/config/default.toml')
  const token = env.CLOUDFLARE_API_TOKEN ?? readFileSync(cfg, 'utf8').match(/^oauth_token\s*=\s*"(.*)"/m)?.[1]
  if (!token) throw new Error('Cloudflare の鍵がない（wrangler login か CLOUDFLARE_API_TOKEN）')
  const gql = async (fields, filter, extra = '') => {
    const q = `{viewer{zones(filter:{zoneTag:"${ZONE_ID}"}){g:httpRequestsAdaptiveGroups(limit:50,${extra}filter:{datetime_geq:"${since}T00:00:00Z",datetime_leq:"${addDays(today, 1)}T00:00:00Z",clientRequestHTTPHost:"${HOST}",requestSource:"eyeball",${filter}}){${fields}}}}}`
    const d = await json('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    })
    if (d.errors) {
      // 回数の上限に当たったら、5 分待って 1 回だけやり直す
      if (/budget depleted/i.test(JSON.stringify(d.errors)) && !gql.retried) {
        gql.retried = true
        await new Promise((r) => setTimeout(r, 5 * 60 * 1000 + 5000))
        return gql(fields, filter, extra)
      }
      throw new Error(JSON.stringify(d.errors).slice(0, 200))
    }
    return d.data.viewer.zones[0].g
  }
  const html = 'edgeResponseContentTypeName:"html",clientRequestHTTPMethodName:"GET"'
  const daily = await gql('dimensions{date} sum{visits} count', html, 'orderBy:[date_ASC],')
  const paths = await gql('dimensions{clientRequestPath} count', html, 'orderBy:[count_DESC],')
  const countries = await gql('dimensions{clientCountryName} sum{visits}', html, 'orderBy:[sum_visits_DESC],')
  // /yt は、YouTube の説明欄に貼る短いリンク。/yt（転送）のアクセスは、ページ（html）ではないので別に数える
  const yt = await gql('dimensions{date} count', 'clientRequestPath:"/yt"', 'orderBy:[date_ASC],')
  return {
    visitsByDay: daily.map((r) => ({ date: r.dimensions.date, visits: r.sum.visits })),
    topPaths: paths.map((r) => ({ path: r.dimensions.clientRequestPath, count: r.count })).slice(0, 10),
    countries: countries.map((r) => ({ country: r.dimensions.clientCountryName, visits: r.sum.visits })).slice(0, 6),
    ytLinkByDay: yt.map((r) => ({ date: r.dimensions.date, clicks: r.count })),
  }
}

// ---- App Store の評価（公開 API。鍵は要らない）
const appStoreRating = async () => {
  const d = await json(`https://itunes.apple.com/lookup?id=${APP_ID}&country=jp`)
  const r = d.results?.[0]
  if (!r) throw new Error('App Store に見つからない')
  return { version: r.version, average: r.averageUserRating, count: r.userRatingCount }
}

// ---- App Store Connect API（鍵：ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH、売上の取得は ASC_VENDOR_NUMBER）
const ascToken = () => {
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' })
  const now = Math.floor(Date.now() / 1000)
  const body = b64({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' })
  const key = createPrivateKey(readFileSync(env.ASC_KEY_PATH.replace(/^~/, homedir())))
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' })
  return `${head}.${body}.${sig.toString('base64url')}`
}
const asc = async (path) => {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, { headers: { Authorization: `Bearer ${ascToken()}` } })
  if (!res.ok) throw new Error(`${res.status} ${path.split('?')[0]} ${(await res.text()).slice(0, 200)}`)
  return res
}
const requireAsc = () => {
  if (!env.ASC_KEY_ID || !env.ASC_ISSUER_ID || !env.ASC_KEY_PATH) throw new Error('ASC の鍵が未設定（docs/daily-growth.md の手順）')
}

// 売上レポート：初回ダウンロード（製品タイプ識別子 1F など）。反映は 1〜2 日遅れる
const ascDownloads = async () => {
  requireAsc()
  if (!env.ASC_VENDOR_NUMBER) throw new Error('ASC_VENDOR_NUMBER が未設定')
  const days = []
  for (let n = 7; n >= 1; n--) {
    const date = addDays(today, -n)
    const q = new URLSearchParams({
      'filter[frequency]': 'DAILY', 'filter[reportType]': 'SALES', 'filter[reportSubType]': 'SUMMARY',
      'filter[vendorNumber]': env.ASC_VENDOR_NUMBER, 'filter[reportDate]': date,
    })
    try {
      const res = await asc(`/v1/salesReports?${q}`)
      const rows = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8').trim().split('\n')
      const cols = rows[0].split('\t')
      const idx = (c) => cols.indexOf(c)
      let first = 0, redownload = 0
      for (const r of rows.slice(1)) {
        const f = r.split('\t')
        if (f[idx('Apple Identifier')] !== APP_ID) continue
        const type = f[idx('Product Type Identifier')], units = Number(f[idx('Units')])
        if (type === '1F' || type === '1') first += units
        else if (type === '3F') redownload += units
      }
      days.push({ date, firstDownloads: first, redownloads: redownload })
    } catch (e) {
      // 404 は、その日の売上が 0（ダウンロードなし）か、レポートがまだ無い。0 として扱い、印を付ける
      days.push(String(e.message).startsWith('404') ? { date, firstDownloads: 0, redownloads: 0, note: '404（0 件、またはまだ無い）' } : { date, note: String(e.message).slice(0, 80) })
    }
  }
  return days
}

// 解析レポート（インプレッション・プロダクトページ閲覧）：レポートの依頼は 1 回だけ作る。
// 依頼の直後は、データが出るまで 1〜2 日かかる。取れた分だけ載せる
const ascAnalytics = async () => {
  requireAsc()
  let reqs = (await (await asc(`/v1/apps/${APP_ID}/analyticsReportRequests`)).json()).data ?? []
  let ongoing = reqs.find((r) => r.attributes.accessType === 'ONGOING')
  if (!ongoing) {
    const res = await fetch('https://api.appstoreconnect.apple.com/v1/analyticsReportRequests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ascToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { type: 'analyticsReportRequests', attributes: { accessType: 'ONGOING' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } }),
    })
    if (!res.ok) throw new Error(`依頼の作成に失敗 ${res.status} ${(await res.text()).slice(0, 150)}`)
    return { note: '解析レポートを依頼した。データは 1〜2 日後から' }
  }
  const reports = (await (await asc(`/v1/analyticsReportRequests/${ongoing.id}/reports?filter[category]=APP_STORE_ENGAGEMENT`)).json()).data ?? []
  const result = {}
  for (const rep of reports) {
    const name = rep.attributes.name
    if (!/Discovery and Engagement|Impressions|Product Page/i.test(name)) continue
    const inst = (await (await asc(`/v1/analyticsReports/${rep.id}/instances?filter[granularity]=DAILY&limit=14`)).json()).data ?? []
    for (const i of inst) {
      const segs = (await (await asc(`/v1/analyticsReportInstances/${i.id}/segments`)).json()).data ?? []
      for (const s of segs) {
        const text = gunzipSync(Buffer.from(await (await fetch(s.attributes.url)).arrayBuffer())).toString('utf8')
        const rows = text.trim().split('\n')
        const cols = rows[0].split('\t')
        for (const r of rows.slice(1)) {
          const f = Object.fromEntries(r.split('\t').map((v, k) => [cols[k], v]))
          const date = f.Date
          const ev = f.Event
          if (!date || !ev) continue
          const key = `${date}|${ev}`
          result[key] = (result[key] ?? 0) + Number(f.Counts ?? 0)
        }
      }
    }
  }
  const byDay = {}
  for (const [k, v] of Object.entries(result)) {
    const [date, ev] = k.split('|')
    ;(byDay[date] ??= {})[ev] = v
  }
  return byDay // 例：{ '2026-10-27': { Impression: 819, 'Page view': 108, ... } }
}

const ascReviews = async () => {
  requireAsc()
  const d = await (await asc(`/v1/apps/${APP_ID}/customerReviews?sort=-createdDate&limit=10`)).json()
  return (d.data ?? []).map((r) => ({ rating: r.attributes.rating, title: r.attributes.title, body: r.attributes.body, date: r.attributes.createdDate, territory: r.attributes.territory }))
}

// ---- YouTube（OAuth の更新トークン：GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / YT_REFRESH_TOKEN）
const ytAccessToken = async () => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.YT_REFRESH_TOKEN) throw new Error('YouTube の鍵が未設定（docs/daily-growth.md の手順）')
  const d = await json('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.YT_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  })
  return d.access_token
}
const youtube = async () => {
  const t = await ytAccessToken()
  const h = { Authorization: `Bearer ${t}` }
  const report = async (metrics, dimensions, extra = {}) => {
    const q = new URLSearchParams({ ids: 'channel==MINE', startDate: since, endDate: today, metrics, dimensions, ...extra })
    return json(`https://youtubeanalytics.googleapis.com/v2/reports?${q}`, { headers: h })
  }
  const byDay = await report('views,estimatedMinutesWatched,likes,subscribersGained,averageViewPercentage', 'day', { sort: 'day' })
  const byVideo = await report('views,likes,subscribersGained,averageViewPercentage', 'video', { sort: '-views', maxResults: '10' })
  const ids = byVideo.rows.map((r) => r[0]).join(',')
  const meta = ids ? await json(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids}`, { headers: h }) : { items: [] }
  const title = Object.fromEntries(meta.items.map((v) => [v.id, v.snippet.title]))
  const source = await report('views', 'insightTrafficSourceType', { sort: '-views' })
  return {
    byDay: byDay.rows.map((r) => ({ date: r[0], views: r[1], minutes: r[2], likes: r[3], subs: r[4], avgViewPct: r[5] })),
    topVideos: byVideo.rows.map((r) => ({ id: r[0], title: title[r[0]], views: r[1], likes: r[2], subs: r[3], avgViewPct: r[4] })),
    trafficSources: source.rows.map((r) => ({ source: r[0], views: r[1] })),
  }
}

await Promise.all([
  attempt('cloudflare', cloudflare),
  attempt('appStoreRating', appStoreRating),
  attempt('ascDownloads', ascDownloads),
  attempt('ascAnalytics', ascAnalytics),
  attempt('ascReviews', ascReviews),
  attempt('youtube', youtube),
])

mkdirSync(join(HOME, 'data'), { recursive: true })
const file = join(HOME, 'data', `${today}.json`)
writeFileSync(file, JSON.stringify(out, null, 2))
console.log(file)
console.log(`errors: ${Object.keys(out.errors).length ? JSON.stringify(out.errors) : 'なし'}`)

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PHOTO_MAX_BYTES } from '../../shared/protocol'
import { bearerToken, isAllowedReturn, parseOrigins, safeEqual, signState, verifyState } from './auth'
import { BadRequest, parseSyncRequest, sync } from './sync'
import {
  accessToken,
  authUrl,
  disconnect,
  exchangeCode,
  isConnected,
  ReauthRequired,
  revoke,
  type GoogleConfig,
} from './youtube'

interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
  APP_TOKEN?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
}

const app = new Hono<{ Bindings: Env }>()

app.use(
  '/api/*',
  cors({
    origin: (origin, c) => (parseOrigins(c.env.ALLOWED_ORIGINS).includes(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
)

// Google から戻ってくる callback 以外は、APP_TOKEN を知っている人だけが使える
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.path === '/api/youtube/callback') return next()
  const expected = c.env.APP_TOKEN
  if (!expected) return c.json({ error: 'server_not_configured' }, 500)
  const given = bearerToken(c.req.header('Authorization'))
  if (!given || !safeEqual(given, expected)) return c.json({ error: 'unauthorized' }, 401)
  return next()
})

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: 'bad_request', message: err.message }, 400)
  if (err instanceof ReauthRequired) return c.json({ error: 'reauth', message: err.message }, 409)
  console.error(err)
  return c.json({ error: 'internal', message: err.message }, 500)
})

app.get('/api/health', (c) => c.json({ ok: true }))

app.post('/api/sync', async (c) => {
  const body = await c.req.json().catch(() => {
    throw new BadRequest('body must be JSON')
  })
  return c.json(await sync(c.env.DB, parseSyncRequest(body)))
})

// ---- 写真 ----

app.put('/api/photos/:id', async (c) => {
  const id = c.req.param('id')
  const type = c.req.header('Content-Type') ?? ''
  if (!/^image\/[a-z0-9.+-]+$/i.test(type)) throw new BadRequest('Content-Type must be image/*')
  const data = await c.req.arrayBuffer()
  if (data.byteLength === 0 || data.byteLength > PHOTO_MAX_BYTES) throw new BadRequest('photo size is out of range')
  await c.env.DB.prepare(
    'INSERT INTO photos (id, type, data, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (id) DO UPDATE SET type = excluded.type, data = excluded.data',
  )
    .bind(id, type, data, Date.now())
    .run()
  return c.json({ ok: true })
})

app.get('/api/photos/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT type, data FROM photos WHERE id = ?1')
    .bind(c.req.param('id'))
    .first<{ type: string; data: ArrayBuffer | number[] }>()
  if (!row) return c.json({ error: 'not_found' }, 404)
  // D1 は BLOB を数値の配列で返すことがあるので、どちらでもバイト列に直す
  return new Response(new Uint8Array(row.data), { headers: { 'Content-Type': row.type, 'Cache-Control': 'private, max-age=31536000' } })
})

// ---- YouTube ----

function googleConfig(env: Env): GoogleConfig | null {
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : null
}

function callbackUrl(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/api/youtube/callback`
}

app.get('/api/youtube/status', async (c) =>
  c.json({ configured: googleConfig(c.env) !== null, connected: await isConnected(c.env.DB) }),
)

app.post('/api/youtube/auth-url', async (c) => {
  const config = googleConfig(c.env)
  if (!config) return c.json({ error: 'youtube_not_configured' }, 400)
  const { returnTo } = (await c.req.json().catch(() => ({}))) as { returnTo?: unknown }
  if (typeof returnTo !== 'string' || !isAllowedReturn(returnTo, parseOrigins(c.env.ALLOWED_ORIGINS))) {
    throw new BadRequest('returnTo is not allowed')
  }
  const state = await signState({ returnTo, issuedAt: Date.now() }, c.env.APP_TOKEN!)
  return c.json({ url: authUrl(config, callbackUrl(c.req.url), state) })
})

app.get('/api/youtube/callback', async (c) => {
  const config = googleConfig(c.env)
  const state = c.env.APP_TOKEN ? await verifyState(c.req.query('state') ?? '', c.env.APP_TOKEN) : null
  if (!config || !state || !isAllowedReturn(state.returnTo, parseOrigins(c.env.ALLOWED_ORIGINS))) {
    return c.text('連携を確認できませんでした。アプリの設定画面からやり直してください。', 400)
  }
  const back = (result: string) => c.redirect(`${state.returnTo.split('#')[0]}#/settings/youtube-${result}`)
  const code = c.req.query('code')
  if (!code) return back('cancelled')
  try {
    await exchangeCode(c.env.DB, config, code, callbackUrl(c.req.url))
    return back('connected')
  } catch (e) {
    console.error(e)
    return back('failed')
  }
})

app.post('/api/youtube/token', async (c) => {
  const config = googleConfig(c.env)
  if (!config) return c.json({ error: 'youtube_not_configured' }, 400)
  return c.json(await accessToken(c.env.DB, config))
})

app.delete('/api/youtube', async (c) => {
  const refresh = await disconnect(c.env.DB)
  if (refresh) await revoke(refresh).catch(() => {})
  return c.json({ ok: true })
})

export default app

import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { PHOTO_MAX_BYTES } from '../../shared/protocol'
import {
  claimLegacy,
  createAuthRequest,
  createSession,
  deleteAuthRequest,
  deleteSession,
  deleteUser,
  finishAuthRequest,
  readAuthRequest,
  readIdToken,
  sha256,
  tooManyAuthStarts,
  upsertUser,
  userForSession,
  type AuthKind,
} from './accounts'
import { bearerToken, isAllowedReturn, parseOrigins, safeEqual, signState, verifyState } from './auth'
import { resultPage } from './resultPage'
import { BadRequest, parseSyncRequest, sync } from './sync'
import { accessToken, authUrl, exchangeCode, ReauthRequired, revoke, type GoogleConfig } from './youtube'

interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
  /** state の署名の鍵。前の版で1人で使っていたデータを引き継ぐときの合言葉にも使う */
  APP_TOKEN?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
}

type App = { Bindings: Env; Variables: { userId: string } }

/** iPhone・Android のアプリの URL スキーム（認可が終わったら、これでアプリへ戻る） */
const APP_SCHEME = 'io.github.makim0939.lattecho'

const app = new Hono<App>()

/** 1人が置ける写真・サムネイルの合計（無料のデータベースの大きさに収めるため） */
const PHOTO_QUOTA_BYTES = 50 * 1024 * 1024

app.use(
  '/api/*',
  cors({
    origin: (origin, c) => (parseOrigins(c.env.ALLOWED_ORIGINS).includes(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type', 'X-Legacy-Token'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
)

/** ログインしなくても使える窓口 */
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/start', '/api/auth/finish', '/api/youtube/callback', '/api/youtube/status'])

// ログインした人だけが使える。だれのデータかは、ログインしたときに渡したトークンで決める
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || PUBLIC_PATHS.has(c.req.path)) return next()
  const token = bearerToken(c.req.header('Authorization'))
  const userId = token ? await userForSession(c.env.DB, token) : null
  if (!userId) return c.json({ error: 'unauthorized' }, 401)
  c.set('userId', userId)
  return next()
})

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: 'bad_request', message: err.message }, 400)
  if (err instanceof ReauthRequired) return c.json({ error: 'reauth', message: err.message }, 409)
  console.error(err)
  return c.json({ error: 'internal', message: err.message }, 500)
})

async function jsonBody(c: Context<App>): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null) throw new BadRequest('body must be a JSON object')
  return body as Record<string, unknown>
}

app.get('/api/health', (c) => c.json({ ok: true }))

app.post('/api/sync', async (c) => c.json(await sync(c.env.DB, c.get('userId'), parseSyncRequest(await jsonBody(c)))))

// ---- 写真 ----

app.put('/api/photos/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const type = c.req.header('Content-Type') ?? ''
  if (!/^image\/[a-z0-9.+-]+$/i.test(type)) throw new BadRequest('Content-Type must be image/*')
  const data = await c.req.arrayBuffer()
  if (data.byteLength === 0 || data.byteLength > PHOTO_MAX_BYTES) throw new BadRequest('photo size is out of range')
  const used = await c.env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM user_photos WHERE user_id = ?1 AND id != ?2')
    .bind(userId, id)
    .first<{ bytes: number }>()
  if ((used?.bytes ?? 0) + data.byteLength > PHOTO_QUOTA_BYTES) {
    return c.json({ error: 'quota', message: 'サーバーに置ける写真の量を超えました' }, 413)
  }
  await c.env.DB.prepare(
    'INSERT INTO user_photos (user_id, id, type, data, size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (user_id, id) DO UPDATE SET type = excluded.type, data = excluded.data, size = excluded.size',
  )
    .bind(userId, id, type, data, data.byteLength, Date.now())
    .run()
  return c.json({ ok: true })
})

app.get('/api/photos/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT type, data FROM user_photos WHERE user_id = ?1 AND id = ?2')
    .bind(c.get('userId'), c.req.param('id'))
    .first<{ type: string; data: ArrayBuffer | number[] }>()
  if (!row) return c.json({ error: 'not_found' }, 404)
  // D1 は BLOB を数値の配列で返すことがあるので、どちらでもバイト列に直す
  return new Response(new Uint8Array(row.data), { headers: { 'Content-Type': row.type, 'Cache-Control': 'private, max-age=31536000' } })
})

// ---- アカウント ----

/** この端末のログインを終える */
app.delete('/api/session', async (c) => {
  const token = bearerToken(c.req.header('Authorization'))
  if (token) await deleteSession(c.env.DB, token)
  return c.json({ ok: true })
})

/** アカウントと、サーバーに置いたデータをすべて消す */
app.delete('/api/account', async (c) => {
  await deleteUser(c.env.DB, c.get('userId'))
  return c.json({ ok: true })
})

/** 前の版で1人で使っていたデータを、ログインした人に引き継ぐ（前のトークンを知っている人だけ） */
app.post('/api/account/claim-legacy', async (c) => {
  const given = c.req.header('X-Legacy-Token')
  if (!c.env.APP_TOKEN || !given || !safeEqual(given, c.env.APP_TOKEN)) return c.json({ error: 'forbidden' }, 403)
  return c.json({ claimed: await claimLegacy(c.env.DB, c.get('userId')) })
})

// ---- Google の画面での認可（ログイン・YouTube の連携） ----

function googleConfig(env: Env): GoogleConfig | null {
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : null
}

/** Google の画面から戻ってくる場所（Google Cloud に登録してある URL。ログインと YouTube で同じものを使う） */
function callbackUrl(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/api/youtube/callback`
}

/**
 * 認可を始める。アプリは番号（id）と、合言葉（verifier）のハッシュ（challenge）を送る。
 * Google の画面で認可が終わると、認可した画面にだけ一度きりのコードを渡す（アプリには URL スキームで、Web 版には戻り先の URL で）。
 * 結果は、そのコードと合言葉の両方を持つ端末だけが受け取れる
 * （Google の画面へのリンクをほかの人に開かせても、結果は開いた人の端末に戻るので横取りできない）。
 * YouTube の連携は、ログインしている人だけが始められる
 */
app.post('/api/auth/start', async (c) => {
  const config = googleConfig(c.env)
  if (!config || !c.env.APP_TOKEN) return c.json({ error: 'google_not_configured' }, 400)
  const { kind, id, challenge, returnTo, app: fromApp } = await jsonBody(c)
  if (kind !== 'login' && kind !== 'youtube') throw new BadRequest('kind is invalid')
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new BadRequest('id is invalid')
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new BadRequest('challenge is invalid')
  if (fromApp !== true && (typeof returnTo !== 'string' || !isAllowedReturn(returnTo, parseOrigins(c.env.ALLOWED_ORIGINS)))) {
    throw new BadRequest('returnTo is not allowed')
  }
  if (await tooManyAuthStarts(c.env.DB)) return c.json({ error: 'busy', message: '混み合っています。少しおいてから試してください' }, 429)
  let userId: string | null = null
  if (kind === 'youtube') {
    const token = bearerToken(c.req.header('Authorization'))
    userId = token ? await userForSession(c.env.DB, token) : null
    if (!userId) return c.json({ error: 'unauthorized' }, 401)
  }
  await createAuthRequest(c.env.DB, { id, kind, challenge, userId })
  const state = await signState(
    fromApp === true ? { id, app: true, issuedAt: Date.now() } : { id, returnTo: returnTo as string, issuedAt: Date.now() },
    c.env.APP_TOKEN,
  )
  return c.json({ url: authUrl(config, callbackUrl(c.req.url), state, kind) })
})

app.get('/api/youtube/callback', async (c) => {
  const config = googleConfig(c.env)
  const state = c.env.APP_TOKEN ? await verifyState(c.req.query('state') ?? '', c.env.APP_TOKEN) : null
  const request = state ? await readAuthRequest(c.env.DB, state.id) : null
  if (!config || !state || !request || request.status !== 'pending') return c.html(resultPage('invalid'), 400)
  const kind: AuthKind = request.kind
  const returnTo = state.returnTo && isAllowedReturn(state.returnTo, parseOrigins(c.env.ALLOWED_ORIGINS)) ? state.returnTo : undefined
  /** 認可した画面を、始めたアプリ・Web 版へ戻す URL。成功したら一度きりのコードを付ける */
  const back = (status: string, oneTimeCode?: string) => {
    const params = new URLSearchParams({ auth_id: request.id, auth_status: status, ...(oneTimeCode ? { auth_code: oneTimeCode } : {}) })
    if (state.app) return `${APP_SCHEME}://auth?${params}`
    return returnTo ? `${returnTo.split('#')[0].split('?')[0]}?${params}#/settings/sync` : undefined
  }
  const code = c.req.query('code')
  if (!code) {
    await finishAuthRequest(c.env.DB, request.id, 'cancelled')
    return c.html(resultPage('cancelled', kind, back('cancelled')))
  }
  try {
    const token = await exchangeCode(config, code, callbackUrl(c.req.url))
    let oneTimeCode: string | undefined
    if (kind === 'login') {
      if (!token.id_token) throw new Error('id_token を受け取れませんでした')
      const { sub, email } = readIdToken(token.id_token)
      const userId = await upsertUser(c.env.DB, sub)
      // メールアドレスはアプリに渡すだけで、サーバーには残さない（結果は受け取られたらすぐ消す）
      oneTimeCode = await finishAuthRequest(c.env.DB, request.id, 'done', { session: await createSession(c.env.DB, userId), email })
    } else {
      if (!token.refresh_token) throw new Error('refresh token を受け取れませんでした')
      // YouTube の鍵は、アプリが受け取ったらすぐ消す（サーバーには残さない）
      oneTimeCode = await finishAuthRequest(c.env.DB, request.id, 'done', { refreshToken: token.refresh_token })
    }
    return c.html(resultPage('connected', kind, back('done', oneTimeCode)))
  } catch (e) {
    console.error(e)
    await finishAuthRequest(c.env.DB, request.id, 'failed')
    return c.html(resultPage('failed', kind, back('failed')), 502)
  }
})

/**
 * 認可の結果を受け取る。始めた端末の合言葉（verifier）と、認可した画面に渡した一度きりのコード（code）の両方が要る。
 * 受け取ったら消す
 */
app.post('/api/auth/finish', async (c) => {
  const { id, verifier, code } = await jsonBody(c)
  if (typeof id !== 'string' || typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128) {
    throw new BadRequest('id and verifier are required')
  }
  const request = await readAuthRequest(c.env.DB, id)
  if (!request) return c.json({ status: 'expired' })
  if (!safeEqual(await sha256(verifier), request.challenge)) return c.json({ error: 'forbidden' }, 403)
  if (request.status === 'pending') return c.json({ status: 'pending' })
  if (request.status === 'done') {
    if (typeof code !== 'string' || !request.code_hash || !safeEqual(await sha256(code), request.code_hash)) {
      return c.json({ error: 'forbidden' }, 403)
    }
  }
  await deleteAuthRequest(c.env.DB, id)
  const result = request.result ? (JSON.parse(request.result) as Record<string, unknown>) : {}
  return c.json({ status: request.status, kind: request.kind, ...result })
})

// ---- YouTube ----

app.get('/api/youtube/status', (c) => c.json({ configured: googleConfig(c.env) !== null }))

/** アプリが持っている YouTube の鍵（refresh token）を、アップロード用の access token に替える。鍵は保存しない */
app.post('/api/youtube/token', async (c) => {
  const config = googleConfig(c.env)
  if (!config) return c.json({ error: 'youtube_not_configured' }, 400)
  const { refreshToken } = await jsonBody(c)
  if (typeof refreshToken !== 'string' || !refreshToken) throw new BadRequest('refreshToken is required')
  return c.json(await accessToken(config, refreshToken))
})

/** YouTube との連携を解除する（Google 側の許可も取り消す） */
app.post('/api/youtube/revoke', async (c) => {
  const { refreshToken } = await jsonBody(c)
  if (typeof refreshToken === 'string' && refreshToken) await revoke(refreshToken).catch(() => {})
  return c.json({ ok: true })
})

export default app

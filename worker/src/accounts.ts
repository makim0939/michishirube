/**
 * Google でログインした利用者と、ログイン中の端末（セッション）。
 * サーバーに持つのは Google のアカウントの番号（sub）だけ。メールアドレスはアプリに返すだけで、保存しない
 */

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))))
}

/** Google のアカウントの番号から利用者を探し、いなければ作る */
export async function upsertUser(db: D1Database, googleSub: string, now = Date.now()): Promise<string> {
  const found = await db.prepare('SELECT id FROM users WHERE google_sub = ?1').bind(googleSub).first<{ id: string }>()
  if (found) return found.id
  const id = crypto.randomUUID()
  await db
    .prepare('INSERT INTO users (id, google_sub, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (google_sub) DO NOTHING')
    .bind(id, googleSub, now)
    .run()
  // 同時に2つの端末で初めてログインしたときは、先に作られたほうを使う
  const row = await db.prepare('SELECT id FROM users WHERE google_sub = ?1').bind(googleSub).first<{ id: string }>()
  return row!.id
}

/** Apple の利用者の番号（sub）から利用者を探し、いなければ作る（Google と同じく、番号だけを持つ） */
export async function upsertAppleUser(db: D1Database, appleSub: string, now = Date.now()): Promise<string> {
  const found = await db.prepare('SELECT id FROM users WHERE apple_sub = ?1').bind(appleSub).first<{ id: string }>()
  if (found) return found.id
  const id = crypto.randomUUID()
  await db
    .prepare('INSERT INTO users (id, apple_sub, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (apple_sub) DO NOTHING')
    .bind(id, appleSub, now)
    .run()
  // 同時に2つの端末で初めてログインしたときは、先に作られたほうを使う
  const row = await db.prepare('SELECT id FROM users WHERE apple_sub = ?1').bind(appleSub).first<{ id: string }>()
  return row!.id
}

/** ログインした端末に渡すトークンを作る。サーバーにはハッシュだけを置く */
export async function createSession(db: D1Database, userId: string, now = Date.now()): Promise<string> {
  const token = randomToken()
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?1, ?2, ?3, ?3)')
    .bind(await sha256(token), userId, now)
    .run()
  return token
}

/** トークンから利用者を探す。使われた日を1日に1回だけ書き直す（書き込みを減らす） */
/** これだけ使われなかったログインは切る（なくした・手放した端末から使われ続けないように） */
export const SESSION_IDLE_MS = 365 * 24 * 60 * 60 * 1000

export async function userForSession(db: D1Database, token: string, now = Date.now()): Promise<string | null> {
  const hash = await sha256(token)
  const row = await db
    .prepare('SELECT user_id, last_used_at FROM sessions WHERE token_hash = ?1')
    .bind(hash)
    .first<{ user_id: string; last_used_at: number }>()
  if (!row) return null
  if (now - row.last_used_at > SESSION_IDLE_MS) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(hash).run()
    return null
  }
  if (now - row.last_used_at > 24 * 60 * 60 * 1000) {
    await db.prepare('UPDATE sessions SET last_used_at = ?1 WHERE token_hash = ?2').bind(now, hash).run()
  }
  return row.user_id
}

export async function deleteSession(db: D1Database, token: string) {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(token)).run()
}

/** Apple のリフレッシュトークンを覚える（退会のときの取り消し用） */
export async function setAppleRefreshToken(db: D1Database, userId: string, token: string) {
  await db.prepare('UPDATE users SET apple_refresh_token = ?2 WHERE id = ?1').bind(userId, token).run()
}

export async function getAppleRefreshToken(db: D1Database, userId: string): Promise<string | undefined> {
  const row = await db.prepare('SELECT apple_refresh_token AS t FROM users WHERE id = ?1').bind(userId).first<{ t: string | null }>()
  return row?.t ?? undefined
}

/** 利用者と、その人のデータをすべて消す（アカウントの削除） */
export async function deleteUser(db: D1Database, userId: string) {
  await db.batch([
    db.prepare('DELETE FROM user_entities WHERE user_id = ?1').bind(userId),
    db.prepare('DELETE FROM user_photos WHERE user_id = ?1').bind(userId),
    db.prepare('DELETE FROM auth_requests WHERE user_id = ?1').bind(userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?1').bind(userId),
  ])
}

/**
 * これまで1人で使っていたデータ（legacy）を、ログインした利用者に引き継ぐ。
 * すでに同じものを持っていれば、利用者のほうを残す
 */
export async function claimLegacy(db: D1Database, userId: string): Promise<number> {
  const results = await db.batch([
    // seq は今の最大より後ろに付け直す（このアカウントのほかの端末は、すでにもっと先まで受け取っているので、古い番号のままだと届かない）
    db
      .prepare(
        "UPDATE OR IGNORE user_entities SET user_id = ?1, seq = seq + (SELECT COALESCE(MAX(seq), 0) FROM user_entities) WHERE user_id = 'legacy'",
      )
      .bind(userId),
    db.prepare("UPDATE OR IGNORE user_photos SET user_id = ?1 WHERE user_id = 'legacy'").bind(userId),
    db.prepare("DELETE FROM user_entities WHERE user_id = 'legacy'"),
    db.prepare("DELETE FROM user_photos WHERE user_id = 'legacy'"),
  ])
  return results[0].meta.changes ?? 0
}

// ---- Google の画面での認可（ログイン・YouTube の連携） ----

export type AuthKind = 'login' | 'youtube'

/** 認可を待つ時間。これを過ぎたものは消す */
export const AUTH_TTL_MS = 10 * 60 * 1000

export type AuthStatus = 'pending' | 'done' | 'cancelled' | 'failed'

export interface AuthRequestRow {
  id: string
  kind: AuthKind
  challenge: string
  user_id: string | null
  status: AuthStatus
  result: string | null
  code_hash: string | null
  created_at: number
}

/**
 * 認可を始められる数（全体で1分あたり）。いたずらで表を埋められないように（10分で消えるので、表は最大でこの10倍の行）。
 * ひとりの相手からの数は、index.ts で接続元ごとに先に絞る。これは、多くの接続元から来たときの最後の歯止めなので、
 * ふつうの利用では届かない程度に大きくしておく（小さいと、いたずらで全員がログインできなくなる）
 */
export const AUTH_STARTS_PER_MINUTE = 600

export async function tooManyAuthStarts(db: D1Database, now = Date.now()): Promise<boolean> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM auth_requests WHERE created_at > ?1')
    .bind(now - 60_000)
    .first<{ n: number }>()
  return (row?.n ?? 0) >= AUTH_STARTS_PER_MINUTE
}

export async function createAuthRequest(
  db: D1Database,
  req: { id: string; kind: AuthKind; challenge: string; userId: string | null },
  now = Date.now(),
) {
  await db.batch([
    db.prepare('DELETE FROM auth_requests WHERE created_at < ?1').bind(now - AUTH_TTL_MS),
    db
      .prepare(
        "INSERT INTO auth_requests (id, kind, challenge, user_id, status, result, code_hash, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', NULL, NULL, ?5)",
      )
      .bind(req.id, req.kind, req.challenge, req.userId, now),
  ])
}

export async function readAuthRequest(db: D1Database, id: string, now = Date.now()): Promise<AuthRequestRow | null> {
  const row = await db.prepare('SELECT * FROM auth_requests WHERE id = ?1').bind(id).first<AuthRequestRow>()
  if (!row || now - row.created_at > AUTH_TTL_MS) return null
  return row
}

/**
 * 認可を終える。成功したら、一度きりのコードを作って返す（認可した画面にだけ渡す）。
 * 結果は、このコードと、始めた端末の合言葉の両方がそろったときだけ受け取れる。
 * 待っている（pending）ものだけを終える。ほかの呼び出し（同じ認可の2回目の戻り）が先に終えていたら、undefined を返す
 */
export async function finishAuthRequest(
  db: D1Database,
  id: string,
  status: AuthStatus,
  result?: unknown,
): Promise<string | undefined> {
  const code = status === 'done' ? randomToken() : undefined
  const { meta } = await claimStatement(db, id, status, result, code ? await sha256(code) : null).run()
  return meta.changes === 1 ? code : undefined
}

function claimStatement(db: D1Database, id: string, status: AuthStatus, result: unknown, codeHash: string | null) {
  return db
    .prepare("UPDATE auth_requests SET status = ?1, result = ?2, code_hash = ?3 WHERE id = ?4 AND status = 'pending'")
    .bind(status, result === undefined ? null : JSON.stringify(result), codeHash, id)
}

/**
 * ログインの認可を終え、その端末のセッションを作る。認可を終えられた（pending から自分が書き換えた）ときだけセッションを作る。
 * 2回戻ってきたとき（同じ認可の画面を2つ開いたなど）に、だれにも渡らないセッションが1年残らないように、
 * 終える文と、セッションを入れる文を1つのトランザクション（batch）にして、セッションは「自分のコードで終えた行があるとき」だけ入れる
 */
export async function finishLogin(
  db: D1Database,
  id: string,
  userId: string,
  email: string | undefined,
  now = Date.now(),
): Promise<string | undefined> {
  const code = randomToken()
  const codeHash = await sha256(code)
  const session = randomToken()
  const [claimed] = await db.batch([
    // メールアドレスはアプリに渡すだけで、サーバーには残さない（結果は受け取られたらすぐ消す）
    claimStatement(db, id, 'done', { session, email }, codeHash),
    db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) SELECT ?1, ?2, ?3, ?3 WHERE EXISTS (SELECT 1 FROM auth_requests WHERE id = ?4 AND status = 'done' AND code_hash = ?5)",
      )
      .bind(await sha256(session), userId, now, id, codeHash),
  ])
  return claimed.meta.changes === 1 ? code : undefined
}

export async function deleteAuthRequest(db: D1Database, id: string) {
  await db.prepare('DELETE FROM auth_requests WHERE id = ?1').bind(id).run()
}

/**
 * Google のトークンの応答にある id_token から、アカウントの番号とメールアドレスを読む。
 * id_token は Google のトークンの窓口から直接（TLS で）受け取ったものなので、署名の確認は省ける（OpenID Connect の決まり）
 */
export function readIdToken(idToken: string): { sub: string; email?: string } {
  const payload = idToken.split('.')[1]
  if (!payload) throw new Error('id_token の形が違います')
  const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))) as {
    sub?: unknown
    email?: unknown
  }
  if (typeof json.sub !== 'string' || !json.sub) throw new Error('アカウントの番号がありません')
  return { sub: json.sub, email: typeof json.email === 'string' ? json.email : undefined }
}

import {
  FEEDBACK_CONTACT_MAX,
  FEEDBACK_ENV_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_PLATFORMS,
  type FeedbackInput,
} from '../../shared/feedback'
import { BadRequest } from './sync'

/** 送れる回数の上限（1分あたり・全体）。ログイン不要の窓口なので、荒らされてもデータベースが埋まらないようにする */
export const FEEDBACK_PER_MINUTE = 30

function text(value: unknown, name: string, max: number, required = false): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') throw new BadRequest(`${name} must be a string`)
  const trimmed = value.trim()
  if (required && !trimmed) throw new BadRequest(`${name} is required`)
  if (trimmed.length > max) throw new BadRequest(`${name} is too long`)
  return trimmed
}

/** 送られてきた要望を検査する */
export function parseFeedback(body: Record<string, unknown>): FeedbackInput {
  const { kind, platform } = body
  if (!FEEDBACK_KINDS.includes(kind as never)) throw new BadRequest('kind is invalid')
  if (!FEEDBACK_PLATFORMS.includes(platform as never)) throw new BadRequest('platform is invalid')
  return {
    kind: kind as FeedbackInput['kind'],
    platform: platform as FeedbackInput['platform'],
    message: text(body.message, 'message', FEEDBACK_MESSAGE_MAX, true),
    contact: text(body.contact, 'contact', FEEDBACK_CONTACT_MAX),
    appVersion: text(body.appVersion, 'appVersion', 32),
    env: text(body.env, 'env', FEEDBACK_ENV_MAX),
  }
}

export async function tooManyFeedbacks(db: D1Database, now = Date.now()): Promise<boolean> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM feedback WHERE created_at > ?1')
    .bind(now - 60_000)
    .first<{ n: number }>()
  return (row?.n ?? 0) >= FEEDBACK_PER_MINUTE
}

export async function saveFeedback(db: D1Database, input: FeedbackInput, now = Date.now()): Promise<string> {
  const id = crypto.randomUUID()
  await db
    .prepare(
      'INSERT INTO feedback (id, created_at, kind, message, contact, platform, app_version, env) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
    )
    .bind(id, now, input.kind, input.message, input.contact, input.platform, input.appVersion, input.env)
    .run()
  return id
}

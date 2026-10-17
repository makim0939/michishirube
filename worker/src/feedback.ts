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

const KIND_LABELS: Record<FeedbackInput['kind'], string> = { idea: 'ご要望', bug: '不具合', other: 'その他' }

/** 返信先がメールアドレスのときだけ、メールの「返信先」にする（改行などの混ざったものは、ヘッダーに入れない） */
const EMAIL_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

/** 届いた要望を、運営者に知らせるメールにする。件名に本文は入れない（通知の一覧に出るので、長さと中身を決めておく） */
export function buildFeedbackMail(input: FeedbackInput, id: string, to: string, from: string, now = Date.now()) {
  const at = new Date(now + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
  const lines = [
    input.message,
    '',
    '---',
    `受信：${at}（日本時間）`,
    `種類：${KIND_LABELS[input.kind]}`,
    `端末：${input.platform}　版：${input.appVersion || '不明'}${input.env ? `　${input.env}` : ''}`,
    `返信先：${input.contact || '（書かれていません）'}`,
    `ID：${id}`,
  ]
  return {
    to,
    from,
    subject: `[ラテ帳] ${KIND_LABELS[input.kind]}が届きました`,
    text: lines.join('\n'),
    ...(EMAIL_PATTERN.test(input.contact) ? { replyTo: input.contact } : {}),
  }
}

export interface FeedbackMailEnv {
  MAIL?: SendEmail
  /** 通知を受け取るメールアドレス。公開リポジトリに書かないので、シークレットに置く */
  FEEDBACK_NOTIFY_TO?: string
  /** 通知の送り元。Email Routing を有効にしたドメインのアドレス */
  FEEDBACK_NOTIFY_FROM?: string
}

/**
 * 運営者にメールで知らせる。届いた要望はもう保存してあるので、送れなくても利用者の送信は成功にする（例外を投げない）。
 * 宛先・送り元・送信の設定が揃っていなければ、何もしない（ローカルの開発・テストでメールが飛ばないように）
 */
export async function notifyFeedback(env: FeedbackMailEnv, input: FeedbackInput, id: string, now = Date.now()): Promise<void> {
  const { MAIL, FEEDBACK_NOTIFY_TO: to, FEEDBACK_NOTIFY_FROM: from } = env
  if (!MAIL || !to || !from) return
  try {
    await MAIL.send(buildFeedbackMail(input, id, to, from, now))
  } catch (e) {
    console.error('feedback mail failed', e instanceof Error ? e.message : e)
  }
}

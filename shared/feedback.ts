/** 要望・不具合の送信（アプリと Worker で共通の決まり） */

export const FEEDBACK_KINDS = ['idea', 'bug', 'other'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const FEEDBACK_PLATFORMS = ['ios', 'android', 'web'] as const
export type FeedbackPlatform = (typeof FEEDBACK_PLATFORMS)[number]

/** 本文の最大文字数（長文の貼り付けで、サーバーの容量を食われないように） */
export const FEEDBACK_MESSAGE_MAX = 2000
/** 返信先（メールアドレスなど）の最大文字数 */
export const FEEDBACK_CONTACT_MAX = 200
/** 端末の情報の最大文字数 */
export const FEEDBACK_ENV_MAX = 200

export interface FeedbackInput {
  kind: FeedbackKind
  message: string
  contact: string
  platform: FeedbackPlatform
  appVersion: string
  /** 端末の種類（OS の版・画面の種類など）。不具合の再現に使う */
  env: string
}

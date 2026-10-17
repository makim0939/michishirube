import { Capacitor } from '@capacitor/core'
import { FEEDBACK_ENV_MAX, type FeedbackInput, type FeedbackKind, type FeedbackPlatform } from '../../shared/feedback'
import { SERVER_URL } from './account'

/** 書きかけの内容（送れなかったとき・途中で画面を離れたときに、書き直さなくて済むように端末に残す） */
const DRAFT_KEY = 'michishirube:feedback-draft'

export interface FeedbackDraft {
  kind: FeedbackKind
  message: string
  contact: string
}

export function loadDraft(): FeedbackDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<FeedbackDraft>
    if (typeof d.message !== 'string') return null
    return {
      kind: d.kind === 'bug' || d.kind === 'other' ? d.kind : 'idea',
      message: d.message,
      contact: typeof d.contact === 'string' ? d.contact : '',
    }
  } catch {
    return null
  }
}

/** 本文が空になったら、残さない */
export function saveDraft(draft: FeedbackDraft) {
  try {
    if (!draft.message.trim() && !draft.contact.trim()) localStorage.removeItem(DRAFT_KEY)
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // 保存できなくても、送る機能には関係しない
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // 同上
  }
}

/** OS の名前と版（User-Agent から。iPhone は「iPhone OS 18_2」、Android は「Android 15」と書いてある） */
export function osOf(ua: string): string {
  const ios = /(?:iPhone OS|CPU OS) (\d+)[_.](\d+)/.exec(ua)
  if (ios) return `${/iPad/.test(ua) ? 'iPadOS' : 'iOS'} ${ios[1]}.${ios[2]}`
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua)
  if (android) return `Android ${android[1]}`
  // iPadOS の Safari は Mac と名乗る。版は分からない
  if (/Macintosh/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return ''
}

/**
 * 不具合の再現に要る、端末の情報。個人を特定するものは入れない。
 * アプリは OS だけ、Web 版は OS とブラウザ、ホーム画面から開いているか（インストール済みの PWA か）まで
 */
export function describeEnvironment(ua: string, platform: FeedbackPlatform, standalone: boolean): string {
  const parts = [osOf(ua)]
  if (platform === 'web') {
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
    parts.push(browser, standalone ? 'ホーム画面から' : 'ブラウザ')
  }
  return parts.filter(Boolean).join('・').slice(0, FEEDBACK_ENV_MAX)
}

function currentPlatform(): FeedbackPlatform {
  const p = Capacitor.getPlatform()
  return p === 'ios' || p === 'android' ? p : 'web'
}

export class FeedbackError extends Error {}

/** 要望を送る。ログインは要らない */
export async function sendFeedback(draft: FeedbackDraft): Promise<void> {
  const platform = currentPlatform()
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  const body: FeedbackInput = {
    kind: draft.kind,
    message: draft.message.trim(),
    contact: draft.contact.trim(),
    platform,
    appVersion: __APP_VERSION__,
    env: describeEnvironment(navigator.userAgent, platform, standalone),
  }
  let res: Response
  try {
    res = await fetch(`${SERVER_URL}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new FeedbackError('送れませんでした。電波を確認してください。書いた内容は残しています')
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { message?: unknown }
    throw new FeedbackError(
      res.status === 429 && typeof json.message === 'string'
        ? json.message
        : '送れませんでした。しばらくしてから、もう一度送ってください。書いた内容は残しています',
    )
  }
}

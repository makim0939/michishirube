import { en } from './en'
import { ja, type Messages } from './ja'

export type Lang = 'ja' | 'en'

/** Web 版で、利用者が選んだ言語を覚えておく場所（無ければ、ブラウザの言語に合わせる） */
const STORAGE_KEY = 'lang'

declare global {
  interface Window {
    /**
     * アプリが動いている言語。iOS のアプリが、ページを読む前に入れる（MainViewController）。
     * iPhone の設定でアプリごとに選んだ言語は、navigator.language に出ないことがあるため
     */
    __APP_LANGUAGE__?: string
  }
}

function toLang(code: string | undefined | null): Lang | undefined {
  if (!code) return undefined
  return code.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

/** Web 版で選んだ言語。'auto' はブラウザの言語に合わせる */
export function getLangChoice(): Lang | 'auto' {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'ja' || v === 'en' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * 言語を選び直す（Web 版だけ）。文言は起動のときに1度だけ決めるので、読み込み直して切り替える
 * （アプリの言語は、端末の設定で変える。変えると OS がアプリを開き直す）
 */
export function setLangChoice(choice: Lang | 'auto') {
  try {
    if (choice === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // 覚えられなくても、今回の切り替えはする
  }
  location.reload()
}

/** 言語を決める。アプリが渡した言語 → Web で選んだ言語 → ブラウザの言語 の順。日本語以外は英語にする */
export function pickLang(app: string | undefined, choice: Lang | 'auto', browser: string | undefined): Lang {
  return toLang(app) ?? (choice !== 'auto' ? choice : undefined) ?? toLang(browser) ?? 'ja'
}

const g = globalThis as { __APP_LANGUAGE__?: string; navigator?: Navigator }

export const lang: Lang = pickLang(g.__APP_LANGUAGE__, getLangChoice(), g.navigator?.languages?.[0] ?? g.navigator?.language)

/** 画面の文言。起動のときに決めた言語のもの */
export const t: Messages = lang === 'en' ? en : ja

/** 日付・数の書き方に使う言語の名前（Intl） */
export const locale = lang === 'en' ? 'en-US' : 'ja-JP'

// 読み上げ・ブラウザの翻訳の案内・タブの名前を、画面の言語に合わせる（index.html は日本語で書いてある）
if (typeof document !== 'undefined') {
  document.documentElement.lang = lang
  document.title = t.settings.appName
}

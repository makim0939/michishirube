import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/**
 * iOS・Android のアプリ（Capacitor）として動いているか。
 * アプリでは「ホーム画面に追加」の案内や、ブラウザに保存を頼む操作はいらない
 */
export const isNativeApp = Capacitor.isNativePlatform()

/** Android のアプリ */
export const isAndroidApp = Capacitor.getPlatform() === 'android'

/** YouTube 利用規約（YouTube に動画を上げる機能には、この規約に沿うことの確認の表示が要る。携帯用のページがある） */
export const YOUTUBE_TERMS_URL = isNativeApp ? 'https://m.youtube.com/t/terms' : 'https://www.youtube.com/t/terms'

/** iPhone・iPad のアプリ */
export const isIosApp = Capacitor.getPlatform() === 'ios'

/** iPhone・iPad か（アプリでも Safari でも。iPadOS の Safari は Mac として名乗るので、タッチ対応かどうかでも判定する） */
export function isIosDevice(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

/**
 * Android の「戻る」（ボタン・端からのスワイプ）。何もしないとアプリが閉じるので、画面の履歴があれば1つ前の画面に戻る。
 * 最初の画面では、アプリを裏に回す（Android のほかのアプリと同じ）
 */
export function watchBackButton() {
  if (Capacitor.getPlatform() !== 'android') return
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else void App.minimizeApp()
  })
}

/** アプリのトップページ・プライバシーポリシー（サーバーと同じドメイン）。アプリはここのページを開く */
export const SITE_URL = 'https://latte.makimura.me/'

/**
 * プライバシーポリシー。アプリの中では、公開しているページを Safari で開く
 * （アプリに入れたファイルを別の窓で開くと、アプリの画面が置き換わってしまうため）
 */
export const PRIVACY_URL = isNativeApp ? `${SITE_URL}privacy` : `${import.meta.env.BASE_URL}privacy.html`

/**
 * App Store のページ・評価の画面。数字は App Store Connect の Apple ID（ストアの URL に出る公開の値。チーム ID とは別）。
 * 開くとき（Safari 経由で App Store アプリへ）は、アプリのリンクと同じく別の窓で開く
 */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6823908010'
export const APP_STORE_REVIEW_URL = `${APP_STORE_URL}?action=write-review`

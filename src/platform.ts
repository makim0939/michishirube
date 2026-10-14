import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/**
 * iOS・Android のアプリ（Capacitor）として動いているか。
 * アプリでは「ホーム画面に追加」の案内や、ブラウザに保存を頼む操作はいらない
 */
export const isNativeApp = Capacitor.isNativePlatform()

/** 公開している Web 版の場所（アプリからプライバシーポリシーなどを開くとき・https の場所が要るときに使う） */
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

export const SITE_URL = 'https://makim0939.github.io/michishirube/'

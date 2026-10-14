import { Capacitor } from '@capacitor/core'

/**
 * iOS・Android のアプリ（Capacitor）として動いているか。
 * アプリでは「ホーム画面に追加」の案内や、ブラウザに保存を頼む操作はいらない
 */
export const isNativeApp = Capacitor.isNativePlatform()

/** 公開している Web 版の場所（アプリからプライバシーポリシーなどを開くとき・https の場所が要るときに使う） */
export const SITE_URL = 'https://makim0939.github.io/michishirube/'

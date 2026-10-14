import { Capacitor } from '@capacitor/core'

/**
 * iOS・Android のアプリ（Capacitor）として動いているか。
 * アプリでは「ホーム画面に追加」の案内や、ブラウザに保存を頼む操作はいらない
 */
export const isNativeApp = Capacitor.isNativePlatform()

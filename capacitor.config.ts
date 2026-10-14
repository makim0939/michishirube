import type { CapacitorConfig } from '@capacitor/cli'

/**
 * iOS・Android のアプリとして配るための設定（Capacitor）。
 * 画面は Web 版と同じものを使い、アプリの中のファイルとして読み込む（pnpm app:build で作って入れる）
 */
const config: CapacitorConfig = {
  // ストアに出すときの識別子（最初に公開する前なら変えられる）
  appId: 'io.github.makim0939.lattecho',
  appName: 'ラテ帳',
  webDir: 'dist',
  backgroundColor: '#faf7f2',
  ios: {
    // 画面の上下（ノッチ・ホームバー）は、画面側で余白をとっている（env(safe-area-inset-*)）
    contentInset: 'never',
  },
}

export default config

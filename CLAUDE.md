# ラテ帳（michishirube）

ラテアートの練習を1杯ずつ撮って残すアプリ。iPhone・iPad・Android（Capacitor）と Web（PWA）、サーバーは Cloudflare Worker + D1。
リポジトリは**公開**。秘密の値・メールアドレス・Apple のチーム ID などを、コミットしない。

## 構成

- `src/ui/`（画面）、`src/domain/`（型・記録のロジック）、`src/data/`（Dexie・同期・ログイン・YouTube）、`src/platform.ts`（端末の判定）
- `src/roadmaps/latte-art.json`：同梱の型（最初の1回だけ入る。入れたあとの人のデータは変わらない）
- `worker/`：API（`/api/*`）と、紹介サイト・プライバシーポリシー（`worker/site/`）。`latte.makimura.me` で配る
- `ios/` `android/`：Capacitor のネイティブ側。Bundle ID は `me.makimura.lattecho`
- `public/world/`：型の見本（`patterns/`）と、記録がないときのホーム背景（`light/`）
- `docs/`：`setup.md`（サーバーの運営）、`oauth-verification.md`（Google の審査）、`app-store-submission.md`（App Store の提出）
- `references/`：参考画像・ChatGPT への依頼の資料。**git に入れない**
- コマンド：`pnpm test`、`pnpm typecheck`、`pnpm app:build`（`VITE_API_URL` をローカルの値にしたまま作らない）。`main` へのマージで、Web 版と Worker が自動で公開される。

## 開発の流れ

- 変更は PR で出す（`main` に直接コミットしない）。PR を出したら `code-review` → `ReportFindings`（直したら `outcome` 付きで再報告）→ ユーザーに報告 → **「マージして」と言われるまでマージしない**。マージ後は、ブランチと作業ツリーを消す。
- **作業ツリーを分ける。** 別のセッションが同じフォルダで作業していることがある。`git worktree add ../michishirube-xxx -b <ブランチ> origin/main`（`node_modules` は `ln -s ../michishirube/node_modules node_modules`）。作業ツリーで `cap sync` をすると `ios/App/CapApp-SPM/Package.swift` と `android/capacitor.settings.gradle` のパスが書き換わる。コミットしない。
- **ユーザーの未コミットの変更を触らない。** 特に `ios/App/App.xcodeproj/project.pbxproj` の `DEVELOPMENT_TEAM`（Xcode の署名設定）。元のフォルダで `checkout -- .`・`stash -u`・`clean` をしない。
- マージ・デプロイ・Google Cloud や App Store Connect の画面の送信など、外に出る操作は、その場でユーザーの許可を取る。
- マージ前に、実際の画面を確認する（ブラウザペイン・iOS シミュレーター）。確認できなかったことは、報告に正直に書く。

## 画面・UX の理念

世界観は、窓辺のカフェのような温かい空間。主役は、利用者が撮ったカップの写真。単純さを目指す。

- 画面に説明文を並べない。押した結果はトースト、補足は選択肢の下の一行だけ。
- ボタンは静かに（太字・影なし）。目立つボタンは1画面に1つ。選択肢は、押す前に見える形に。
- 押し付けない。リマインド・通知・常設の警告は出さない。
- 画面に操作を詰め込まない。主役と補助を分ける。新しい UI は、似たアプリを調べてから作る。
- がたつきを残さない（折り返し、余白、ちらつき、読み込み中の切り替え）。
- 記録の手間をほぼゼロに。迷ったら、足すより削る。
- 紹介サイトは、飾りより分かりやすさ優先。

## コード

- コメントは日本語で、なぜそうするかを書く。テストは日本語の名前で挙動を書く。
- iOS と Android の共通のコードを片方のために変えるときは、もう片方への影響を確認し、端末ごとに分岐する（実例：Android 向けの仕組みで、iPhone が WebM 録画になり、編集・共有・アップが壊れた）。
- 実運用の不具合の報告を受けたら、同じ種類の不具合が他の画面・端末にないか、横展開で確認する。

## 確認の環境

- iOS：`xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`。シミュレーターにカメラはない。iPhone の録画は MP4 だけ。
- Android：ビルドに JDK 21 が必要。エミュレーターには H.264 のエンコーダーがなく、録画は実機と挙動が違う。
- 実機はユーザーが Xcode で確認する。確認してほしい手順を、具体的に渡す。

## いまの状況（変わったら更新する）

- Google の OAuth 審査（YouTube のアップロード権限）が審査中（2026-10-16 提出）。**通るまで、Google Cloud のブランディング（アプリ名・ロゴ・URL）、紹介サイトのアイコン（`worker/site/icon.png`・`favicon.ico`）、ホームページとプライバシーポリシーの大きな変更をしない。** アプリの中の画像や、端末・ストアのアイコンは変えてよい。
- App Store への提出を準備中（iPhone・iPad の両方。「Apple でサインイン」は付けず、指摘されたら足す）。手順は `docs/app-store-submission.md`。Android のストア提出は見送り。

## 引き継ぎとスキル

- セッションを分けて進めている。別のセッションへ引き継ぐときは、役割分担・用意したもののパス・決まったこと・触らないものを、メッセージで伝え、**最初に `CLAUDE.md` を読むよう**書く。長いときは `references/` にメモを置く。
- スキル（`.claude/skills/`）は、その場の指示では足りない手順が、繰り返し出てきたときだけ作る。いまある3つ：
  - `worktree-pr`：作業ツリー → PR → レビュー → マージ → 片づけ（この流れで開発する）
  - `verify-on-device`：ブラウザ・iOS シミュレーター・Android エミュレーター・実機での確認（デバッグ・UX レビュー）
  - `app-screenshots`：アプリの画面を撮る（紹介サイト・記事・App Store の画面写真）

---
name: ios-release
description: iOS アプリ（iPhone・iPad）のビルド・アップロード・App Store への提出の手順。「App Store に出したい」「TestFlight に上げたい」「提出の準備」と言われたときに使う。判断と入力案は docs/app-store-submission.md。
---

# iOS アプリを App Store に出す

判断・チェックリスト・文面の案・審査メモは **`docs/app-store-submission.md`**。まず読む。ここでは、作業の手順と、つまずきやすい点を書く。

## 先に決まっていること

- Bundle ID：`me.makimura.lattecho`（変えない）。iPhone と iPad の**両方**を出す（iPad の画面写真が必須。13インチ：2064×2752 または 2048×2732）。
- 「Apple でサインイン」は、まだ付けない（案A：審査メモで説明して先に出す。ガイドライン 4.8 を指摘されたら、足す）。
- 審査メモ（英語）は、`docs/app-store-submission.md` の5章。YouTube の審査（Google）が審査中のあいだは、「未確認のアプリ」の画面が出ることも書いてある。

## ビルドとアップロード

1. 作業ツリーで、最新の `main` を使う（スキル `worktree-pr`）。ただし、**署名の設定（`DEVELOPMENT_TEAM`）は、ユーザーの元のフォルダの Xcode にある**。アップロードの作業は、ユーザーの Xcode で行う（Claude は、`xcodebuild archive` を、ユーザーの許可なしに走らせない）。
2. `pnpm app:build`（`tsc` → `CAPACITOR=1 vite build` → `cap sync`）。**`VITE_API_URL` に、ローカルの値を入れたまま作らない。** 本番のサーバーは `https://latte.makimura.me`（既定）。
3. 事前の確認：
   - `pnpm typecheck`・`pnpm test`
   - iOS シミュレーターでのビルド（スキル `verify-on-device`）。`CFBundleIdentifier` が `me.makimura.lattecho`。
   - 実機で、撮る → 編集 → 保存 → 共有 → アップ（ユーザーが確認する）。
4. バージョン：`MARKETING_VERSION`（1.0）と、`CURRENT_PROJECT_VERSION`（ビルド番号。**アップロードのたびに上げる**）。
5. `Info.plist` に `ITSAppUsesNonExemptEncryption = NO`（HTTPS だけの暗号化＝免除の申告）を入れると、アップロードのたびの質問が出ない。入れるときは PR にして、ユーザーに確認する。
6. Xcode：Signing & Capabilities で、有料のチーム（Apple Developer Program）を選ぶ。Destination「Any iOS Device (arm64)」→ Product > Archive → Organizer の「Distribute App」→「App Store Connect」→ アップロード。
7. App Store Connect：ビルドの処理を待つ → バージョンにビルドを選ぶ → 文面・画面写真・プライバシーの申告・年齢区分・審査メモ → 「審査へ提出」。**画面の操作・送信は、ユーザーの許可を取る**（Claude が行う場合も、1回ごとに）。
8. 審査は、通常 1〜2 日。指摘が来たら、Resolution Center に返信する（内容は、ユーザーが貼る。回答案を作る）。

## TestFlight

審査に出す前に、TestFlight で自分の iPhone に入れて確認できる（ビルドのアップロード後）。有料プログラムでは、無料の署名の7日の期限も、なくなる。

## 画面写真

iPhone：1179×2556 または 1206×2622（Dynamic Island の機種）。iPad：2064×2752 または 2048×2732。透明なし。1つの大きさだけ出せば、小さい端末用は、縮められる（提出前に、App Store Connect の表記で確認する）。
撮り方：iOS シミュレーターで、大きさが合う機種を選び、アプリを動かして撮る（`verify-on-device`）。運用データは、見せてよいものだけ。アイコン・型の見本・ホーム画像を新しくしたあとに、撮り直す。

## つまずきやすい点

- 作業ツリーで `cap sync` すると、`ios/App/CapApp-SPM/Package.swift` のパスが書き換わる。コミットしない。
- ユーザーの `project.pbxproj` の未コミットの変更（`DEVELOPMENT_TEAM`）に触らない。Bundle ID を変える PR のあとは、ユーザーが `git stash` → `git pull` → `git stash pop` で取り込む。
- アプリ名・ロゴを、Google の審査中に変えない（`CLAUDE.md` の5章）。
- 審査員が見る機能（YouTube 連携）は、審査メモに、手順どおり書く。隠れた機能を作らない（ガイドライン 2.3.1）。

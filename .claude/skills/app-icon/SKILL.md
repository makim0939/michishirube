---
name: app-icon
description: アプリのアイコンを新しくする手順。1枚の元画像から、iOS・Android・PWA・ファビコン（と、審査後に紹介サイト）の全サイズを作って入れる。アイコンを差し替える、ChatGPT で作ったアイコンの絵を受け取ったときに使う。
---

# アプリのアイコンを新しくする

絵は、ユーザーが ChatGPT で作る（依頼文はスキル `chatgpt-image-assets`）。Claude は、受け取った1枚から、すべての大きさを作って入れる。

## 元画像の条件（受け取ったら確かめる）

- 1024×1024 の正方形（PNG）。**透明なし・角は丸くしない**（丸みは OS が付ける）。文字・枠線なし。
- カップ全体（取っ手も）が、中央 70% に収まっている（円・角丸に切り抜かれても欠けない）。
- 60px に縮めても、ロゼッタのラテアートと分かる（模様と、クレマのコントラスト）。
- 満たさないなら、ChatGPT に頼み直す（「カップを小さく」「四隅まで木で埋めて」など）。

## 手順

1. 作業ツリーを作る（スキル `worktree-pr`）。元画像を `references/` に置く（git に入れない）。
2. スクリプトで、全サイズを作る：
   ```bash
   python3 -I .claude/skills/app-icon/make_icons.py <元画像.png> --preview <scratch>/icon-preview.png
   ```
   - `--dry-run`：作るファイルの一覧だけを出す。`--root <フォルダ>`：別のフォルダに作る（試すとき）。
   - `--android-scale 0.9`：Android の適応型アイコンで、元画像を縮める割合（既定 0.9。周りの5%を、鏡写しで埋める）。
   - **`--site` は、Google の審査が終わるまで付けない**（下）。
3. **プレビュー画像を見て確かめる**（`--preview`）：左から、元画像／iOS 風の角丸／Android の円（適応型の中央 72/108 だけが見える）／120・60・29px。
   Android の円で、カップ・取っ手が欠けていないか、60px で分かるかを見る。欠けるなら、`--android-scale` を小さくするか、元画像を作り直す。
4. 作られるもの：
   - iOS：`ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`（1024・透明なし。App Store Connect の 1024 のアイコンと同じ絵）
   - Android：`android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_foreground.png`・`ic_launcher.png`・`ic_launcher_round.png`（適応型は `mipmap-anydpi-v26/ic_launcher.xml`。背景色は `values/ic_launcher_background.xml`＝#FAF7F2。前景は透明なしで、背景は見えない）
   - PWA：`public/pwa-64x64.png`・`pwa-192x192.png`・`pwa-512x512.png`（`vite.config.ts` の manifest で `any maskable`）・`apple-touch-icon-180x180.png`・`favicon.ico`（16・32・48）
5. 確認（スキル `verify-on-device`）：iOS シミュレーターでホーム画面のアイコン、Web 版のタブのアイコン。Android は、エミュレーター（円・角丸・しずく型）。
6. PR（スキル `worktree-pr`）。

## 審査中の注意（重要）

Google の OAuth 審査に出した「アプリのロゴ」は、**そのときのアイコン**。審査が終わるまで、次を変えない：
- Google Cloud の「ブランディング」のロゴ
- 紹介サイトのアイコン（`worker/site/icon.png`・`favicon.ico`）。`--site` を付けない
アプリの中・端末・ストアのアイコンは、変えてよい。審査が通ったら、`--site` で、サイトのアイコンを更新し、Google Cloud のブランディングのロゴを再提出する（再提出になるので、ユーザーに相談する。画面の操作は、ユーザーの許可を取る）。

## App Store 用

- App Store Connect の「アプリアイコン」は、iOS と同じ 1024×1024（透明なし）を、アップロードする（ビルドに入ったアイコンが使われるので、通常は、ビルドのアップロードで足りる）。
- 画面写真は別（`docs/app-store-submission.md` の6章）。

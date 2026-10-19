---
name: verify-on-device
description: 画面や動作を、ブラウザ・iOS シミュレーター・Android エミュレーター・実機で確認する方法。PR をマージする前の画面確認、不具合の再現、動画・録画まわりの確認に使う。
---

# 動作の確認

マージ前に、**実際の画面**を確認する（`CLAUDE.md` の「開発の流れ」）。確認できなかったことは、報告で、正直に書く。

## ブラウザ（Web 版）

- 開発サーバー：`pnpm dev --port 5180`（サーバー `ALLOWED_ORIGINS` に、`localhost:5179`・`5180` が入っている）。ブラウザペイン（`mcp__Claude_Browser__*`）で、`http://localhost:5180/` を開く。スマホ幅は `resize_window` の `mobile`（375×812）。**終わったら `desktop` に戻す。**
- ローカルのサーバーを試すときは `pnpm worker:dev`（8787）と、`VITE_API_URL=http://localhost:8787`。**この値をつけたまま、配るビルドを作らない。**
- 本物のデータで見たいとき：ユーザーの Chrome に、Web 版（`https://makim0939.github.io/michishirube/`）があり、運用データが入っている（claude-in-chrome）。**読むだけにして、保存・削除の操作をしない**（編集画面を開いたら、保存せずに閉じる）。ユーザーが許可したとき以外は、運用データに触らない。
- 紹介サイトは、`worker/site/` を `python3 -m http.server <ポート>` で配れば見られる（API は不要）。

## iOS シミュレーター

1. 先に `mcp__Claude_Code_iOS_Simulator__control` の `attach` を呼ぶ（ユーザーが見られるように。起動していなければ、エラーになるので、ビルド後に再度）。
2. 画面を作ってアプリに入れる：`pnpm app:build`（`tsc` → `CAPACITOR=1 vite build` → `cap sync`）。
3. ビルド：
   ```bash
   cd ios/App && xcodebuild -project App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO -derivedDataPath <scratch>/dd build
   ```
   できた `.app` の `Info.plist`（`PlistBuddy -c "Print :CFBundleIdentifier"`）で、Bundle ID を確かめられる。
4. `control` の `launch`（`app_path` に、`<scratch>/dd/Build/Products/Debug-iphonesimulator/App.app`）→ `screenshot`・`tap`・`swipe`。
- **シミュレーターには、カメラがない。** 撮影は、画面（canvas）の録画で `MediaRecorder` の動きを確かめる（iOS 18.2 のシミュレーターの Safari が使える）。撮影そのものは、実機で。
- iPhone は **MP4 だけ**（`recorderSupports`）。WebM になっていたら、不具合。

## Android エミュレーター

- SDK は `~/Library/Android/sdk`（`emulator`・`platform-tools/adb`）。ビルドには **JDK 21** が要る（Android Studio の JDK を使う。`JAVA_HOME` を指定する）。`android/local.properties` に `sdk.dir`（元のフォルダにある。作業ツリーには無いので、`ANDROID_HOME` で渡す）。
- エミュレーターには、H.264 のハードウェアエンコーダーが無く、**録画の挙動が実機と違う**。録画まわりは、エミュレーターの結果を、実機の結果とみなさない。
- WebView のデバッグは、`adb forward` と Chrome DevTools Protocol（CDP）。
- 使える AVD：`Pixel_6_API_Baklava`（Android 16）、`Pixel_3a_API_30_x86`。JDK 21 は sdkman（`~/.sdkman/candidates/java/21*`）にある。起動は `emulator -avd <名前> -no-snapshot-save -no-audio`（バックグラウンドで。`adb shell getprop sys.boot_completed` が 1 になるまで待つ）。
- 画面を作って入れる流れ：`pnpm app:build` → `cd android && ./gradlew assembleDebug` → `adb install -r app/build/outputs/apk/debug/app-debug.apk` → `adb shell am start -n me.makimura.lattecho.app/me.makimura.lattecho.MainActivity`。許可ダイアログを飛ばすなら `adb shell pm grant me.makimura.lattecho.app android.permission.CAMERA`（`RECORD_AUDIO` も）。
- 操作は `adb shell input tap / swipe / keyevent KEYCODE_BACK`、画面は `adb exec-out screencap -p > x.png`。**エミュレーターは遅い**（起動直後は「System UI が応答していません」が出る。「待つ」を押す）。タップのあとは数秒〜10秒待ち、1手ずつ画面を見て進める（連続で押すと、別の画面に入る）。`screencap` は、たまに古い画面を返すので、撮り直す。
- **画面の端（左右 4% ほど）から始めるスワイプは、システムの「戻る」になる**。ハンドルなどをドラッグするときは、端から離して始める。戻るの確認は `KEYCODE_BACK` で。

## 実機（iPhone）

- ユーザーが Xcode でビルドして確認する。確認してほしい手順を、**具体的に**書いて渡す（例：「撮る → 編集 → 保存 → 共有 → アップ」）。共通のコードを触った PR は、iPhone でもこの手順を。
- 原因調査：Mac に繋がっていれば、`xcrun devicectl` で、アプリのファイル（`Documents/lattecho/media` など）と localStorage（`Library/WebKit/…/LocalStorage/localstorage.sqlite3`）を読める（`xcrun devicectl device copy from --help` で構文を確認する）。
- 実機の画面録画・スクリーンショットは、ユーザーが貼ってくれる。見て、気づいたことを、具体的に返す。

## 確認の観点

- 画面：がたつき（折り返し・余白・ちらつき・真っ白）、UX 理念（`CLAUDE.md` の「画面・UX の理念」）。
- 端末：iOS と Android の両方に影響しないか（`CLAUDE.md` の「コード」）。
- 動画・写真：端末に無いとき（YouTube にあるとき）の見え方・操作がそろっているか。

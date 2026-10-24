# App Store への提出の準備

iPhone・iPad のアプリ「ラテ帳」を、App Store に出すための手順・判断・入力案をまとめたものです。
Apple の規約の確認日：2026-10-17。提出の前に、App Review Guidelines と App Store Connect の画面を、もう一度確認してください（更新されることがあります）。

公式：

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)

## 1. 用語

- **Bundle ID**：アプリの「固有の名前」（`me.makimura.lattecho.app`。所有ドメイン makimura.me を逆にした形）。App Store・端末が、アプリを見分けるのに使う。ストアに登録したあとは変えられない。
  配信前の 2026-10-17 に、`io.github.makim0939.lattecho` → `me.makimura.lattecho` → `me.makimura.lattecho.app` と変えた（Android の applicationId、Google ログインから戻る URL スキームも同じ値）。
  最後の変更の理由：`me.makimura.lattecho` は、無料の Personal Team が Xcode の自動署名で先に登録していて、有料のチームでは登録できなかったため（Apple 全体で、Bundle ID は重複できない。無料チームのものは、自分では削除できない）。**開発中は、必ず有料のチームで署名する。**
  変えるたびに、前の ID で端末に入っているアプリとは別のアプリになる。記録は、前のアプリの「設定 → バックアップ」で書き出し、新しいアプリで復元する。
- **署名（コード署名）**：このアプリが「この開発者が作り、途中で書き換えられていない」ことを、Apple が発行する証明書で証明する仕組み。App Store に出すアプリには、配布用の署名が要る。Xcode の「Automatically manage signing」にチームを選ぶと、証明書とプロビジョニングプロファイル（どのアプリを、どの証明書で、どう配るかの許可証）を、自動で作る。`DEVELOPMENT_TEAM`（チーム ID）は、各自の値で、リポジトリには入れない。`ios/signing.xcconfig`（git に入れないファイル）に `DEVELOPMENT_TEAM = <チーム ID>` と1行書くと、Xcode が読む（`ios/debug.xcconfig` から読み込んでいる）。Xcode の画面でチームを選ぶと、`project.pbxproj` に書き込まれて差分が出るので、画面ではなくこのファイルに書く。
  Apple Developer Program に入ったあとは、Xcode の「Signing & Capabilities」で、有料のチームを選び直す。

## 2. 先に決めること

### 2-1. Google ログインと、Apple の「ほかのログインも用意する」ルール（4.8）

Guideline 4.8（Login Services）：第三者のログイン（Google など）を、**主アカウントの作成・認証**に使うアプリは、次の条件を満たす、同等のログイン（実質、「Apple でサインイン」）も用意する。

- 収集するのは、名前とメールアドレスだけ
- メールアドレスを非公開にできる
- 広告のために、利用の記録を、同意なく集めない

免除：自社のアカウントだけを使う／教育・企業の既存アカウント必須／特定の第三者サービスのクライアント（そのサービスに、直接ログインして中身を見る）など。

ラテ帳の場合：

- Google ログインは**任意**で、ログインしなくても、すべての機能が使える（5.1.1(v)「ログインなしで使えるように」を満たす）。
- ただし、ログインすると、Google のアカウント識別子で、サーバーにアカウントができる（同期用）。ほかのアカウント方式は無い。→ 審査員が「主アカウントの作成」と見る可能性があり、**4.8 を指摘される恐れは小さくない**。

選択肢：

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| A. 審査メモで説明して、先に出す（推奨） | 「ログインは任意の同期用。アプリは、ログインなしで、すべて使える」と書く | 作り込みなしで、すぐ出せる | 指摘されたら、1回分（数日）遅れる |
| B. 先に「Apple でサインイン」を足す | サーバーで Apple の ID トークンを検証し、Apple の識別子でもアカウントを作る。端末側の権限（entitlement）と、Apple 側の設定も要る | 指摘を避けられる | 作業が大きい。Google 側・Apple 側のアカウントが、別々になる。いま使っている運用データの、アカウントの統合が難しい |

→ **A で出し、指摘されたら B を作る**のがおすすめ。急いで確実にしたいなら、B を先に。
ログインの扱いは、審査メモ（5 章）に、先に書いておく。

### 2-2. iPad

1.0 は iPhone のみで出した（`TARGETED_DEVICE_FAMILY = 1`。iPad の画面写真は不要だった）。

**1.1 から、iPad に対応して出す**（2026-10-24 に決定。`TARGETED_DEVICE_FAMILY = "1,2"`。画面は、中央の最大幅 680px の列のまま）。iPad に対応する版は、次が要る（App Store Connect の画面写真の仕様で確認済み。iPhone の写真は、iPad の代わりにならない）：

- iPad の画面写真：**13 インチ用（2048×2732 か 2064×2752）を最低 1 枚**。画面の作りが各サイズで同じなら、13 インチ用だけで、小さい iPad 用は自動で縮小される（1〜10 枚）
- 出す前に、iPad の実機で、撮る → 編集 → 保存 → 共有 を確認する

### 2-3. YouTube の鍵（トークン）の扱い（5.1.1(v)）

5.1.1(v)：「ソーシャルネットワークの認証情報やトークンを、端末の外に保存してはいけない」「アプリ内で、連携を取り消せること」。
ラテ帳：YouTube の鍵（refresh token）は端末にだけ保存する。ただし、連携の直後に、端末へ渡すために、サーバーが**最長10分**だけ預かり、受け取られたらすぐ消す。また、アップロードの前に、端末が鍵をサーバーに送り、1時間の access token に替えてもらう（サーバーは鍵を保存しない）。連携は、アプリ内からいつでも解除できる（Google 側の許可も取り消される）。
→ 「保存」ではなく「通過」であることを、審査メモに書く（5 章。書いてある）。指摘されたら、同じ説明を返信する。

### 2-4. YouTube の審査（Google）

2026-10-17 に通過した。実機で、連携のときに、「Google で確認されていません」の警告が出ず、アプリ名の「ラテ帳」が表示されることを確認済み。審査メモに、警告についての記述は不要（外した）。

## 3. 提出のチェックリスト

| # | 項目 | 状況 |
|---|---|---|
| 1 | Apple Developer Program に加入 | 済み |
| 2 | Bundle ID を決める（`me.makimura.lattecho.app`） | 決定・反映済み（別 PR） |
| 3 | Xcode の署名を、有料のチームにする | これから |
| 4 | App Store Connect で、「新規 App」を作る（名前・言語・Bundle ID・SKU） | これから |
| 5 | アプリのアイコン（1024px・透明なし）を入れる | 別セッションで作成中 |
| 6 | 書き出しの暗号化の申告（`ITSAppUsesNonExemptEncryption`。HTTPS だけなら、免除の申告） | これから |
| 7 | iPhone の画面写真（1〜10枚）を用意する（6 章） | これから |
| 8 | 名前・サブタイトル・説明・キーワード・カテゴリ（4 章） | 案あり |
| 9 | プライバシーポリシー URL、サポート URL | 下に記載 |
| 10 | アプリのプライバシー（収集するデータの申告） | 済み（4-4。内容は App Store Connect が正） |
| 11 | 年齢区分の質問に答える | 案あり（4-5） |
| 12 | 審査メモ（5 章） | 案あり |
| 13 | Archive → App Store Connect へアップロード → ビルドを選んで、審査に出す（7 章） | これから |

URL：

- プライバシーポリシー：`https://latte.makimura.me/privacy`（英語：`/privacy-en`）
- サポート：`https://latte.makimura.me/`（または GitHub の Issues）
- マーケティング URL（任意）：`https://latte.makimura.me/`

アプリの中にも、プライバシーポリシーへのリンクがある（5.1.1(i)の要件。設定 → アカウント）。

## 4. App Store Connect に入れる文面（案）

### 4-1. 名前・サブタイトル・プロモーション

| 項目 | 上限 | 案 |
|---|---|---|
| 名前 | 30文字 | ラテ帳：ラテアートの練習記録 |
| サブタイトル | 30文字 | 動画と写真で、上達が見える練習帳 |
| プロモーション用テキスト | 170文字 | 1杯ずつ撮って、成功・惜しい・失敗と次の一手をメモ。最初の1杯と並べれば、上達が目で見えます。 |
| キーワード | 100文字（カンマ区切り） | ラテアート,練習,記録,バリスタ,カフェ,コーヒー,エスプレッソ,動画,上達,ロゼッタ,ハート,チューリップ |

### 4-2. 説明文（4000文字まで）

（プロモーション用テキストには、「◎△✕」が使えなかった。「■」が使えないときは、「【 】」に置き換える。）

```
ラテアートの練習を、1杯ずつ動画と写真で記録するアプリです。

■ 使い方は、3ステップ
1. 撮る：「記録する」を押すと、すぐカメラが開きます。注ぐ様子を動画で、できあがりを写真で。
2. ふり返る：成功・惜しい・失敗を選び、次の一手をひとこと書けば、記録は終わりです。メモは、書きたいときだけで大丈夫です。
3. 見くらべる：最初の1杯と、最新の1杯を、動画でも写真でも並べて見られます。

■ 次の1杯へ
前回の「次の一手」は、次に撮るときカメラの上に表示されます。つまずきやすいところは、記録から自動でまとめます。

■ 型ごとに練習
ハート、チューリップ、ロゼッタ、レイヤーハート、ウィングチューリップ、ウィングハート、スワン。型ごとに記録をまとめます。型はおすすめの順につながっていて、どの型からでも始められます。

■ 記録は、あなたのもの
はじめは、記録を端末の中だけに保存します。登録は要りません。
Google でログインすると、機種を変えても、別の端末でも、同じ記録を使えます（任意）。
動画の保存先を YouTube にすると、スマホの容量を使わずに残せます（標準は限定公開。YouTube への連携は任意です）。

■ こんな人に
・練習しているのに、上達した実感がない
・うまくいった理由、いかなかった理由を、次の日には忘れている
・動画や写真が、スマホの中に散らばっている
```

（「YouTube に動画を上げる機能」は、YouTube 利用規約に沿うことを、アプリの画面に表示している。審査メモにも書く。）

### 4-3. カテゴリ

- 主：ライフスタイル
- 副：フード／ドリンク

### 4-4. アプリのプライバシー（収集するデータの申告）

申告の内容は、**App Store Connect の「Appのプライバシー」が正**。ここには書き写さない（機能を足すたびに、ここと食い違うため。実際に、「ご意見・ご要望」を足したあと、この案が古いまま残っていた）。

見直すのは、サーバーに送るものが変わったとき（機能を足す・ポリシーを変える）。プライバシーポリシー（`/privacy`）と食い違わないようにする。

### 4-5. 年齢区分

質問（暴力・性的表現・ギャンブル・ユーザー生成コンテンツの共有など）は、すべて「なし」。想定：4+。
（SNS のような共有機能は無い。YouTube への動画のアップロードは、本人のチャンネルへ、本人が行う。）

## 5. 審査メモ（App Review Notes）— 英語

```
Latte-chō (ラテ帳) is a practice journal for latte art. Users record each cup with a photo and a short video, mark how it went, and compare their first and latest cups.

HOW TO TRY IT (no account or demo login is needed)
1. Open the app and tap a pattern (e.g. "Heart"), then tap "Record" to take a short video and a photo. Camera and microphone are used only for this. The microphone is optional (silent recording works).
2. Choose a result (success / close / fail), optionally tap causes, write a "next step", and save. The record appears in the "Cup journal" tab.
3. Open the pattern again to compare the first and the latest cup.
You can also pick existing photos/videos from the photo library.

SIGN-IN IS OPTIONAL (Guideline 4.8 / 5.1.1(v))
Every feature works without signing in; records stay on the device. Signing in with Google (Settings > Account) is optional and only syncs the user's records across their own devices. Google data requested at sign-in: account identifier and email (scopes: openid, email). Users can sign out, and can delete their account and all server data in the app (Settings > Account > Delete account).

OPTIONAL YOUTUBE LINK (Guideline 5.2.2)
In Settings > Account, users can optionally link their own YouTube channel (scope: youtube.upload). Practice videos are then uploaded, from the device directly to YouTube, to the user's own channel, unlisted by default. Before linking, the app shows that uploaded videos must comply with the YouTube Terms of Service and are uploaded as "not made for kids". The YouTube refresh token is kept only on the device: it passes through our server only to be handed to the device (deleted on receipt, at most 10 minutes) and to be exchanged for a one-hour access token before each upload; it is never persisted on the server. Users can unlink at any time (this also revokes the permission). We use the YouTube API Services in accordance with the YouTube API Services Terms of Service.

PRIVACY
Privacy policy: https://latte.makimura.me/privacy-en (also linked in the app). Support: https://latte.makimura.me/
Contact: makim0939@gmail.com
```

## 6. 画面写真

- 形式：JPEG か PNG（**透明なし**）。1〜10枚。
- iPhone（必須）：Dynamic Island のある機種の縦：**1179×2556 か 1206×2622**（提出前に、App Store Connect の表記で確認）。1つの大きさだけ出せば、小さい端末用は、自動で縮小される。
- iPad：iPad に対応する場合は必須（13インチ：2064×2752 か 2048×2732。最低 1 枚）。→ 2-2 のとおり、1.1 から iPad に対応する。

画面写真には、説明の見出しと背景を足す（他のアプリの並べ方に合わせた）。撮った画面を、`python3 -I .claude/skills/app-screenshots/appstore-shot.py` で仕上げる（状態バーの時刻・電池も、9:41・満タンに直る。スキル `app-screenshots` の D）。

案（5枚。紹介サイトの流れに合わせる）：

1. 今日の画面（最新の1杯と、記録するボタン）
2. 記録（◎△✕・次の一手。原因のタグは、1.1 で出さなくなった）
3. 最初と最新の見くらべ
4. 次の一手・自分のコツ
5. 型の一覧

撮り方（実機の画面を使う）：iPhone 12（1170×2532）と iPad Air 第4世代（1640×2360）の実機で、運用データの画面を撮り、App Store の大きさに変換する（スキル `app-screenshots` の C）。
- iPhone：1179×2556 に、ほぼ同じ縦横比なので、少し拡大して、足りない数ピクセルを端の色で伸ばす。
- iPad：13インチ用の 2048×2732 に、高さに合わせて拡大し、左右を端の色で伸ばす（アプリは、中央の列と背景色の余白の作りなので、つなぎ目が目立たない）。

シミュレーターで撮る場合：iOS シミュレーターで、大きさが合う機種（iPhone 17 Pro 相当）を選び、運用データか、見せてよいデータで撮る。画面は、ブラウザではなく、アプリ（シミュレーター）から撮る。アプリのアイコン・型の見本・ホームの画像を新しくした後に、撮り直す。

## 7. ビルドとアップロード（Xcode）

1. `pnpm app:build` で、アプリ用に作って `ios/` に入れる（**`VITE_API_URL` を、ローカルの値にしたまま作らない**）。
2. Xcode で `ios/App/App.xcodeproj` を開く（または `pnpm app:ios`。`.xcworkspace` は無い）。
3. Signing & Capabilities：Team を有料のチームにする。Bundle Identifier を確認する。
4. バージョン（`MARKETING_VERSION`。版の決め方は `docs/versioning.md`）とビルド番号（`CURRENT_PROJECT_VERSION`）。**アップロードのたびに、ビルド番号を上げる**。
   - 上げる前に、App Store Connect の TestFlight で、**最後に送ったビルド番号を確かめる**。リポジトリの値（ふだんは 1）は、手元で上げた番号とずれていることがある（1.0 の提出で送った 2 は、コミットしていない手元の変更だった）。
   - 確かめた番号より 1 つ大きい値にしてから、Archive する。送ったあとの番号は、リリースの PR で、リポジトリにも反映する。
5. 書き出しの暗号化：`Info.plist` に `ITSAppUsesNonExemptEncryption = NO`（HTTPS だけなら、免除）を入れると、アップロードのたびの質問が、出なくなる。
6. 実機かシミュレーターで、最後の動作確認：撮る → 編集 → 保存 → 共有 → アップ。
7. Product > Destination を「Any iOS Device (arm64)」にして、Product > Archive。Organizer で「Distribute App」→「App Store Connect」→ アップロード。
8. App Store Connect で、ビルドが処理されるのを待ち（数分〜）、バージョンにそのビルドを選ぶ。
9. 文面・画面写真・プライバシー・審査メモを入れて、「審査へ提出」。
10. 審査は、通常1〜2日。指摘が来たら、メッセージ（Resolution Center）に、答える。

### TestFlight（任意）

審査に出す前に、TestFlight で、自分の iPhone に入れて確認できる（ビルドをアップロードしたあと）。有料プログラムの加入後は、7日で切れる署名の制限も、なくなる。

## 8. 提出後・ほかの注意

- 審査中（Google・Apple のどちらも）、アプリ名・ロゴ・ホームページの内容は、大きく変えない。
- 起動時に落ちない、リンクが切れていない（プライバシーポリシー・サポート）、審査メモに書いた手順どおりに動く、を、出す前に確認する（2.1：完成版であること）。
- 2.3.1：審査メモに書いていない、隠れた機能は無いこと。
- 通ったあと、アプリのアイコン・型の見本・ホームの画像を、更新するときは、新しいビルドを出す（その都度、審査）。

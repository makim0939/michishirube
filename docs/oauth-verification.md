# YouTube 権限の審査（OAuth アプリの確認）の準備

ラテ帳は、利用者の YouTube に動画をアップロードするために `youtube.upload` の権限を求めます。この権限は、公開前に Google の審査（機密性の高いスコープの確認）が要ります。審査を通るまでは、連携のときに「Google で確認されていません」の警告が出て、連携できる人数にも上限があります。

このページは、審査に出すものと手順をまとめたものです。英語の文面は、そのまま貼り付けられます。

公式ページ（2026-10-15 に確認）：

- [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)

## 1. 出す前のチェック

| 項目 | 状況 |
|---|---|
| ドメインの所有確認（Search Console。`makimura.me`） | 済み |
| ホームページ `https://latte.makimura.me/`（アプリの説明・誰でも見られる） | 済み（日本語と英語の説明） |
| プライバシーポリシー `https://latte.makimura.me/privacy`（英語版 `/privacy-en`）。ホームページと同じドメイン | 済み |
| ブランディング（アプリ名「ラテ帳」・ロゴ・各 URL）の公開 | 済み |
| 要求する権限は、使うものだけ（`openid`・`email`・`youtube.upload`） | 済み |
| ポリシーに、YouTube API サービスの使用・YouTube 利用規約・Google プライバシー ポリシー・Google のアクセス許可ページ・問い合わせ先を書く | 済み |
| アプリに、YouTube 利用規約に沿うことの確認の表示と、「子ども向けではない」の表示（設定 → アカウント） | 済み |
| ポリシーが、サーバーでの一時的な預かり（最長10分）を正確に書いている | 済み |
| 権限を使う理由の説明（下の 2） | 下書き済み |
| 使い方の動画（下の 3） | これから撮る |

## 2. 提出用の文面（英語）

### 2-1. Scope justification — `https://www.googleapis.com/auth/youtube.upload`

```text
Latte-chō (ラテ帳) is a practice journal for latte art. Users record each cup they pour as a short video and a photo, mark how it went, and review their progress over time.

The app requests the youtube.upload scope only when a user explicitly links YouTube in Settings → Account and chooses YouTube as the place to keep their practice videos. With this scope the app uploads the practice videos the user recorded in the app to the user's own YouTube channel. Videos are uploaded as "Unlisted" by default; the user can choose "Public" in Settings or per video.

Why this feature: practice videos are large. Keeping them on YouTube lets users free storage on their phone while still being able to watch and share them.

Why youtube.upload and nothing broader: the app only needs to insert videos (videos.insert). It does not read, list, edit or delete anything on the user's channel, so youtube.upload — the narrowest scope that allows uploading — is sufficient. A narrower scope that permits uploading does not exist.

The app never uploads anything without the user having linked YouTube and chosen YouTube as the storage destination. Before linking, the app shows that uploaded videos must comply with the YouTube Terms of Service and that videos are uploaded as "not made for kids". Users can unlink at any time in Settings → Account → YouTube → Unlink, which also revokes the permission on Google's side.
```

### 2-2. How the app uses, stores and shares Google user data

```text
Data received: (1) At sign-in: the Google account identifier (sub) and the email address (scopes openid, email). (2) When YouTube is linked: a refresh token for the youtube.upload scope.

Use: The email address is used only to show the user, on their own device, which account is signed in. The sub identifies the user's account on our server so the same records can be used on multiple devices. The refresh token is used only to obtain short-lived access tokens to upload the user's own videos to the user's own channel.

Storage: The email address is not stored on our server as a record. The refresh token is stored only on the user's device. During sign-in or YouTube linking, the result (email / refresh token) is held temporarily in our server database only until the user's device receives it, then deleted immediately; a result that is never received expires after 10 minutes and is deleted the next time anyone starts signing in. Before each upload the device sends the refresh token to our server, which exchanges it for an access token (one hour) and does not store the refresh token. The video itself is uploaded directly from the device to YouTube and never passes through our server. The server stores only the user's practice records, downsized photos and video thumbnails, keyed by the Google sub (and hashes of device session tokens).

Sharing: We do not share, sell or transfer Google user data to anyone, we do not use it for advertising, and no human reads it. Our use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

Deletion: Users can delete their account in Settings → Account → Delete account, which immediately deletes all server data. Users can unlink YouTube in the app or revoke access at https://security.google.com/settings/security/permissions at any time.
```

### 2-3. Feature documentation links（最大3つ）

```text
https://latte.makimura.me/
https://latte.makimura.me/privacy-en
https://github.com/makim0939/michishirube
```

### 2-4. 想定される質問と答え

- **サーバーが refresh token を受け取るのはなぜか。** クライアントシークレットはサーバーにだけあり、アプリ（端末）には置けないため。サーバーは、認可コードを refresh token に替えるときと、アップロードの前に access token に替えるときだけ通し、保存しない。
- **`prompt=consent` と `access_type=offline` を使うのはなぜか。** 連携のたびに、確実に refresh token を受け取るため（YouTube への連携のときだけ）。
- **どの YouTube チャンネルに上がるのか。** 同意画面で利用者が選んだ Google アカウントの、チャンネル（同意画面でチャンネルを選べる場合は、その選択）。チャンネル名を表示するには、読み取りの権限（`youtube.readonly`）を足す必要があり、要らない権限は求めない方針のため、表示していない。
- **子ども向けの扱いは。** アップロードのときに `selfDeclaredMadeForKids: false` で上げる。アプリの画面に「子ども向けではないとして上げます」と表示している。
- **EU の利用者は。** EU の利用者向けの同意の方針（EU User Consent Policy）は、対象になったとき、同意の取得と記録の仕組みを足す。

## 3. 使い方の動画

### 撮る前の用意

- 録画ソフトは、Mac の「画面収録」（Shift+Command+5）などでよい。マイクで英語の説明を入れるか、英語の字幕を後から入れる。
- **同意画面を英語にする**（Google の指定）：<https://myaccount.google.com/language> で、Google アカウントの言語を「English」にする。撮り終えたら、日本語に戻す。
- 画面は、パソコンの Chrome で **Web 版**（`https://makim0939.github.io/michishirube/`）を使う。アプリの中のログイン画面は、アドレスバーが見えず、クライアント ID を見せられないため。
- 練習用に、記録のある状態にしておく。YouTube と連携していない状態から始める（すでに連携しているなら、設定 → アカウント → YouTube → 連携を解除）。
- 動画は、YouTube Studio に「限定公開」で上げる。審査の申請の欄に、その URL を貼る。

### 台本（3〜4分）

| 時間 | 画面 | 英語の説明（そのまま読める） |
|---|---|---|
| 0:00 | ホームページ `latte.makimura.me` | "This is Latte-chō, a practice journal for latte art. Users record their pours as short videos and photos." |
| 0:20 | Web 版を開き、記録の画面を見せる | "Records stay on the device by default. Signing in with Google lets users use the same records on other devices." |
| 0:40 | 設定 → アカウント → Google でログイン。同意画面を見せ、アドレスバーを見せる | "This is the sign-in consent screen. It shows the app name, Latte-chō. Here in the address bar you can see our OAuth client ID." （アドレスバーを拡大して、`client_id=…` を見せる） |
| 1:10 | ログインを許可して戻る | "The app only asks for the basic profile information for signing in." |
| 1:30 | 設定 → アカウント。「YouTube と連携」を押す前に、ボタンの下の説明（YouTube 利用規約・子ども向けではない）を見せてから、ボタンを押す | "Now the user links YouTube. Before linking, the app tells the user that uploaded videos must comply with the YouTube Terms of Service and are uploaded as not made for kids. This is the only place where the app asks for the YouTube upload permission." |
| 1:45 | 同意画面（YouTube）。権限の文言とアドレスバー（`client_id`・`scope=…youtube.upload`）を見せる | "The consent screen shows the app name and the permission, 'Manage your YouTube videos'. In the address bar, the scope is youtube.upload and our client ID is visible." （拡大して見せる） |
| 2:10 | 許可して戻る。「連携しました」の表示を見せる | "After granting, the app shows that YouTube is linked." |
| 2:30 | 設定 → 動画 → 保存先を「YouTube」にする | "The user chooses YouTube as the storage destination for videos. Nothing is uploaded unless the user does this." |
| 2:45 | 記録する → 短い動画を撮る（または選ぶ）→ 保存 | "The user records a short practice video and saves the record." |
| 3:05 | 設定 → アカウントで、アップが進むのを見せる。続けて、YouTube Studio を開き、動画が「限定公開」で入っているのを見せる | "The app uploads the video to the user's own YouTube channel. In YouTube Studio the video appears with visibility 'Unlisted'. This is the only thing the permission is used for." |
| 3:30 | 設定 → アカウント → YouTube → 連携を解除。続けて、Google の「アプリのアクセス許可」ページを見せる | "The user can unlink at any time. This also revokes the permission on Google's side, and it can also be revoked here in the Google account permissions page." |
| 3:50 | プライバシーポリシー（英語）を見せる | "The privacy policy explains what data is handled and how it can be deleted." |

撮影のコツ：

- 同意画面とアドレスバーのところは、少し止めて、拡大して見せる（クライアント ID と、スコープの文字が読めること）。
- アプリの画面は日本語のままでよいが、説明は英語で。字幕を入れるなら、台本の英語の列を使う。
- 動画は、YouTube Studio にアップロードして、公開設定を「限定公開」にする。

## 4. 申請の手順

画面の名前は、Google Cloud の更新で変わることがあります。

1. <https://console.cloud.google.com/> でプロジェクトを開き、「Google Auth Platform」を開く。
2. 「ブランディング」が公開済みであることを確認する（済み）。
3. 「データアクセス」で、スコープが3つ（`openid`・`email`・`youtube.upload`）だけであることを確認する。
4. 「確認センター」を開き、申請を始める。
   - 権限（`youtube.upload`）の説明に、上の 2-1 を貼る。
   - 動画のリンクに、限定公開の YouTube の URL を貼る。
   - 機能の説明のリンクに、上の 2-3 を貼る。
   - データの扱いを聞かれたら、2-2 を貼る。
5. 申請する。Google から、メール（サポートメールのアドレス）で質問が来ることがある。数日以内に、答える。
6. 審査中は、ブランディングを変えない。
7. 通ったら、連携のときに警告が消えることを、実機で確認する。

## 5. 通ったあとにすること

- YouTube の割り当てが足りなくなってきたら、「YouTube API Services - Audit and Quota Extension Form」を出す（別の手続き）。初期の割り当ては、プロジェクト全体で1日100本とされている（公式ページの表記）。
- 権限を増やすとき（読み取りなど）は、あらためて審査になる。

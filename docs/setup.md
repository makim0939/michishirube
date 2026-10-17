# サーバーの運営（Google ログイン・同期・YouTube 連携）

利用者は、アプリの「設定 → アカウント」で **Google でログイン** するだけで、記録と写真をほかの端末でも使えます。
このページは、そのためのサーバー（Cloudflare Workers + D1）を**運営する人**向けの手順です。

## サーバーに置くもの・置かないもの

| 置くもの（ログインした人だけ） | 置かないもの |
|---|---|
| 記録・型・分野・設定、動画と写真の情報（種類・大きさ・日時・YouTube の動画 ID） | 動画の中身（端末か、利用者自身の YouTube） |
| 縮小した写真・動画のサムネイル（1人 50MB まで） | Google のメールアドレス・名前・パスワード |
| Google アカウントの番号（sub）、ログイン中の端末のトークンのハッシュ | YouTube の鍵（refresh token。端末にだけ置き、アップロードの前に access token へ替えるときだけ通す） |

利用者は「アカウントを削除」で、サーバーのデータをすべて消せます。

このほか、「設定 → ご意見・ご要望」から届いた要望は、ログインの有無に関係なく `feedback` テーブルに置きます（本文・種類・アプリの版・OS など。返信先は、本人が書いたときだけ）。利用者とは結び付けず、アカウントを削除しても残ります。読み方は「4. 届いた要望を読む」。

## 1. Cloudflare

### 1-1. 公開する

```bash
pnpm install
```

```bash
npx wrangler login
```

```bash
pnpm worker:migrate --remote
```

```bash
pnpm worker:deploy
```

- **データベースの更新（migrate）を先に行ってから、公開（deploy）します。** 逆にすると、新しいサーバーが古い表を読もうとして失敗します。
- サーバーの URL は `https://latte.makimura.me` です（`worker/wrangler.jsonc` の `routes`。Cloudflare で `makimura.me` を管理している同じアカウントなら、公開するときにドメインの割り当て・証明書も自動で行われます）。アプリは `src/data/account.ts` の `SERVER_URL` に書いたサーバーを使います。
- 同じドメインで、`/api/*` はサーバー、それ以外は `worker/site/` のトップページ（`/`）とプライバシーポリシー（`/privacy`）を返します。`worker/site/privacy.html` は `public/privacy.html`（アプリの中・Web 版のもの）のコピーで、ずれるとテストが失敗します。直すときは両方に同じものを入れてください。
- 前の URL（`https://michishirube-api.makim0939.workers.dev`）も、同じサーバーのまま動きます。独自ドメインにする前のアプリがつながるので、止めないでください。

### 1-2. 署名の鍵を登録する

Google の画面へ渡す値の署名に使います。推測されない長い文字列にします（前の版で使っていた `APP_TOKEN` があれば、そのまま使えます）。

```bash
openssl rand -hex 32
```

```bash
npx wrangler secret put APP_TOKEN --config worker/wrangler.jsonc
```

> 前の版（合言葉でつなぐ形）で置いていた記録は、更新のときに「引き継ぎ待ち」として残ります。前の合言葉でつないでいた端末で Google にログインすると、そのアカウントに引き継がれます。

### 1-3. （任意）サーバーの更新を自動にする

GitHub に push して使っている場合、`worker/` の変更が `main` に入ったときに、GitHub Actions が自動でサーバーを更新します（データベースの更新も一緒に行います）。

1. Cloudflare のダッシュボード → 右上のアイコン →「プロフィール」→「API トークン」→「トークンを作成」
2. 「Cloudflare Workers を編集する」のテンプレートを選び、権限に **アカウント → D1 → 編集** を足して作成し、トークンを控えます（ゾーンのリソースには、独自ドメインを管理している `makimura.me` を含めます。ドメインの割り当てに使います）
3. ダッシュボードの「Workers & Pages」の右側に出ている **アカウント ID** を控えます
4. GitHub のリポジトリ →「Settings」→「Environments」で `production` を作り、「Deployment branches and tags」を `main` だけにします
5. 「Environment secrets」に `CLOUDFLARE_API_TOKEN`（2）と `CLOUDFLARE_ACCOUNT_ID`（3）を登録します

## 2. Google

### 2-1. プロジェクトと API

1. <https://console.cloud.google.com/> で新しいプロジェクトを作ります。
2. 「API とサービス」→「ライブラリ」で **YouTube Data API v3** を有効にします。

### 2-2. 同意画面（Google Auth Platform）

1. アプリ名は「ラテ帳」、対象は **外部**。
2. 「ブランディング」：
   - ホームページ：`https://latte.makimura.me/`
   - プライバシー ポリシー：`https://latte.makimura.me/privacy`
   - 承認済みドメイン：`makimura.me`（Search Console で、同じ Google アカウントでドメインの所有を確認しておく。`github.io` と `workers.dev` は共有のドメインなので入れられない）
   - 同意画面にアプリ名として出る「ラテ帳」が、ホームページの表示（タイトル・見出し）と一致していること
3. 「データアクセス」で、次のスコープを追加します。
   - `openid`、`.../auth/userinfo.email`（ログイン。審査の軽いスコープ）
   - `https://www.googleapis.com/auth/youtube.upload`（YouTube へのアップロード。**審査が必要なスコープ**）
4. 公開ステータスを **本番環境** にします。

### 2-3. OAuth クライアント

1. 「クライアント」→「クライアントを作成」で **ウェブ アプリケーション** を選びます。
2. 「承認済みのリダイレクト URI」に、次を入れます（ログインと YouTube の連携で同じものを使います）。

   ```text
   https://latte.makimura.me/api/youtube/callback
   https://michishirube-api.makim0939.workers.dev/api/youtube/callback
   ```

   下の1つは、独自ドメインにする前のアプリ用です（消さないでください）。

3. クライアント ID とシークレットを登録します。

```bash
npx wrangler secret put GOOGLE_CLIENT_ID --config worker/wrangler.jsonc
```

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET --config worker/wrangler.jsonc
```

## 3. 利用者が増える前にすること

- **Google の審査（YouTube の権限）**：審査を通るまでは、YouTube と連携できるのは 100 人まで、連携のときに「確認されていないアプリ」と出ます。ログインだけ（`openid`・`email`）なら審査は軽く済みます。審査には、プライバシーポリシー・ドメインの確認・使い方の動画が要り、数週間かかることがあります。
- **YouTube の割り当て**：1日に上げられる本数は、プロジェクト全体（全利用者の合計）で決まっています。「API とサービス」→「割り当て」で確認し、足りなくなる前に増枠を申請します。
- **データベースの大きさ**：D1 は無料プランで1つのデータベースが 500MB まで（有料プランは 10GB）。記録は1杯 1KB ほどなので当分足りますが、写真（1人 50MB まで）で埋まっていきます。利用者が数人を超えたら、写真だけを R2（無料枠 10GB、超えた分は 1GB あたり月 $0.015）に移します。

## 4. 届いた要望を読む

```bash
pnpm exec wrangler d1 execute michishirube --remote --config worker/wrangler.jsonc \
  --command "SELECT datetime(created_at/1000,'unixepoch','localtime') AS at, kind, platform, app_version, env, message, contact FROM feedback ORDER BY created_at DESC LIMIT 20"
```

届いたときは、メールでも知らせます（下の「要望の通知メール」）。対応が済んだものは `DELETE FROM feedback WHERE id = '…'` で消します（個人情報になりうる返信先を、長く置かない）。荒らし対策に、送れるのは全体で1分に30件までです。

### 要望の通知メール

要望が届くと、運営者のメールに本文と端末の情報を送ります（Cloudflare の Email Routing の `send_email`。送れなくても、要望は保存され、利用者の送信は成功になります）。宛先と送り元は、公開リポジトリに書かないので、シークレットに置きます。

1. Cloudflare のダッシュボードで、ドメイン（`makimura.me`）の「Email」→「Email Routing」を有効にする（案内に従って DNS を追加）。
2. 「宛先アドレス」に通知を受け取るアドレスを追加し、届いた確認メールのリンクを開く（確認済みのアドレスにしか送れない）。
3. シークレットを登録する。
   ```bash
   pnpm exec wrangler secret put FEEDBACK_NOTIFY_TO   --config worker/wrangler.jsonc   # 通知を受け取るアドレス（2. で確認したもの）
   pnpm exec wrangler secret put FEEDBACK_NOTIFY_FROM --config worker/wrangler.jsonc   # 送り元。makimura.me のアドレス（例：noreply@makimura.me）
   ```
4. アプリから要望を1件送って、届くことを確かめる。届かないときは、`wrangler tail` か、ダッシュボードの Worker のログで `feedback mail failed` を探す。

どちらかのシークレットが無いときは、メールを送らない（ローカルの開発など）。

## 開発

`pnpm worker:dev` でサーバーを手元で動かせます。Web 版・アプリをそのサーバーにつなぐときは、`VITE_API_URL=http://127.0.0.1:8787` を付けて起動・ビルドします。**実機に入れるビルドには付けないでください**（実機の `127.0.0.1` は端末自身なので、サーバーにつながらなくなります）。

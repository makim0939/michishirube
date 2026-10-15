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
- 最後に表示される `https://michishirube-api.〇〇.workers.dev` がサーバーの URL です。アプリは `src/data/account.ts` の `SERVER_URL` に書いたサーバーを使います。

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
2. 「Cloudflare Workers を編集する」のテンプレートを選び、権限に **アカウント → D1 → 編集** を足して作成し、トークンを控えます
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
   - ホームページ：`https://makim0939.github.io/michishirube/`
   - プライバシー ポリシー：`https://makim0939.github.io/michishirube/privacy.html`
   - 承認済みドメイン：`makim0939.github.io` と `makim0939.workers.dev`
3. 「データアクセス」で、次のスコープを追加します。
   - `openid`、`.../auth/userinfo.email`（ログイン。審査の軽いスコープ）
   - `https://www.googleapis.com/auth/youtube.upload`（YouTube へのアップロード。**審査が必要なスコープ**）
4. 公開ステータスを **本番環境** にします。

### 2-3. OAuth クライアント

1. 「クライアント」→「クライアントを作成」で **ウェブ アプリケーション** を選びます。
2. 「承認済みのリダイレクト URI」に、次を入れます（ログインと YouTube の連携で同じものを使います）。

   ```text
   https://michishirube-api.〇〇.workers.dev/api/youtube/callback
   ```

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

## 開発

`pnpm worker:dev` でサーバーを手元で動かせます。Web 版・アプリをそのサーバーにつなぐときは、`VITE_API_URL=http://127.0.0.1:8787` を付けて起動・ビルドします。

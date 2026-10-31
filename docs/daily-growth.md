# 毎日の分析とアクション（日次の見回り）

毎日 20:00 に、その日のアナリティクスを集めて、アプリを「ターゲット」に届けるためのアクションを 1 つ実行する。ユーザーに依頼せず回るのが目的。

**ターゲット**：自宅（またはカフェ）でラテアートを練習している・始めたい、25〜44 歳の日本の人。スマホで YouTube ショートやラテアートの動画を見ている。

## 構成

| もの | 置き場所 | 備考 |
|---|---|---|
| 収集スクリプト | `scripts/daily/collect.mjs` | 依存なし。取れなかった元は `errors` に理由を残して続ける |
| YouTube の説明欄の更新 | `scripts/daily/yt-description.mjs` | 案内ブロック（`▼ラテ帳`〜`▲`）だけを書き換える。元の説明欄は自動でバックアップ |
| YouTube の認可（1 回だけ） | `scripts/daily/auth-youtube.mjs` | 更新トークンを `~/.latte-daily/env` に書く |
| 秘密の値 | `~/.latte-daily/env`、`~/.latte-daily/*.p8` | **git に入れない**（公開リポジトリ）。この Mac だけ |
| 集めたデータ | `~/.latte-daily/data/YYYY-MM-DD.json` | |
| 日報 | `~/.latte-daily/report/YYYY-MM-DD.md` | 数字・見立て・やったこと・やらなかったこと |
| 実行の記録 | `~/.latte-daily/actions.jsonl` | 1 行 1 件（日付・種類・対象・戻し方） |

## 最初の準備（ユーザーが 1 回だけ）

秘密の値は、すべて `~/.latte-daily/` に置く（git の外）。チャット・リポジトリ・PR には書かない。ない鍵の元は、収集が `errors` に出して、ほかの元で続ける。

### 0. フォルダを作る

```bash
mkdir -p ~/.latte-daily && chmod 700 ~/.latte-daily && touch ~/.latte-daily/env && chmod 600 ~/.latte-daily/env
```

### 1. App Store Connect の API キー（約 5 分）

1. <https://appstoreconnect.apple.com/access/integrations/api> を開く（「ユーザとアクセス」→「統合」→「App Store Connect API」。アカウントの持ち主（アカウント管理者）だけが開ける）。
2. 初めてなら「キーをリクエスト」でアクセスを有効にする。
3. 「キーを生成」→ 名前は `latte-daily`、アクセス権は **Admin**（App Manager では、売上と解析が 403 で取れない。Apple のロール表で、App Manager には「アプリ分析」「売上とトレンド」の権限がない。売上と解析だけなら Sales でも取れるが、レビューは取れない）。
4. 一覧の **Issuer ID** と、作ったキーの **Key ID** を控える。
5. 「APIキーをダウンロード」で `.p8` を取る（**ダウンロードは 1 回だけ**）。`~/.latte-daily/` に置いて `chmod 600` する。
6. 「売上およびトレンド」（<https://appstoreconnect.apple.com/trends/>）の左上、アカウント名の横に出る数字が **Vendor Number**（ベンダー番号。「支払いと財務レポート」にも出る）。
7. `~/.latte-daily/env` に書く。

```
ASC_KEY_ID=（Key ID）
ASC_ISSUER_ID=（Issuer ID）
ASC_KEY_PATH=~/.latte-daily/AuthKey_（Key ID）.p8
ASC_VENDOR_NUMBER=（Vendor Number）
```

初日は、解析レポートの依頼が作られるだけで、インプレッションなどは 1〜2 日後から出る。

### 2. YouTube（Google の OAuth。約 10 分）

「Google Cloud」の、**ラテ帳のログイン用とは別のプロジェクト**を作る（審査中の同意画面に触れないため）。

1. <https://console.cloud.google.com/projectcreate> でプロジェクトを作る（名前は `latte-daily`）。
2. 「API とサービス」→「ライブラリ」で、**YouTube Data API v3** と **YouTube Analytics API** を有効にする。
3. 「OAuth 同意画面」→ 外部 → アプリ名 `latte-daily`、サポートメールと連絡先は自分のもの。スコープは足さなくてよい（認可のときに出る）。
4. 同意画面の「公開ステータス」を **「本番環境に公開」**にする。「テスト」のままだと、更新トークンが **7 日で切れる**（毎週ログインが要る）。自分だけが使うので、確認済みアプリの審査は要らない。認可のとき「このアプリは Google で確認されていません」と出たら、「詳細」→「latte-daily（安全ではないページ）に移動」で進む。
5. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」→ 種類は **デスクトップ アプリ**。
6. 出た **クライアント ID** と **クライアント シークレット**を、`~/.latte-daily/env` に書く。

```
GOOGLE_CLIENT_ID=（クライアント ID）
GOOGLE_CLIENT_SECRET=（クライアント シークレット）
```

7. リポジトリで次を実行し、表示された URL をブラウザで開く。**らておのチャンネルの Google アカウント**で、2 つの権限（解析の閲覧・YouTube の管理）を許可する。

```bash
node scripts/daily/auth-youtube.mjs
```

「YT_REFRESH_TOKEN を ~/.latte-daily/env に書きました」と出れば完了（トークンは画面に出ない）。権限は、解析の読み取りと、動画の説明欄の更新だけ。動画のアップロード・削除はしない。

### 3. Cloudflare

`wrangler login` 済みなら、追加の準備は要らない（収集のたびに、wrangler がトークンを更新する）。ログインが切れていたら、`cd worker && npx wrangler login` をやり直す。

### 4. 動作確認

```bash
node scripts/daily/collect.mjs
```

最後の `errors:` が `なし` なら、全部取れている。

## 毎日の手順（20:00）

1. **集める**：`node scripts/daily/collect.mjs`。出力された JSON を読む。`errors` があれば、日報の冒頭に書く（鍵の期限切れ・未設定は、ユーザーに頼むことの 1 行目にする）。
2. **見る**：直近 14 日と比べて、変わったところを探す。見る数字は、次の流れ。
   - YouTube：視聴回数、最後まで見た割合、登録、高評価、どの動画が伸びたか
   - 説明欄のリンク：`/yt` のアクセス数（`ytLinkByDay`）
   - サイト：訪問、ページ別
   - App Store：インプレッション → プロダクトページ閲覧 → ダウンロード、評価・レビュー
   - 落ちているところ（どの段で、いちばん人が減っているか）が、その日の課題。
3. **アクションを 1 つ決めて、実行する**（下の「アクション」）。何もしない日があってよい。数字が小さい日に、無理に動かさない。
4. **日報を書く**：`~/.latte-daily/report/YYYY-MM-DD.md`。やったことは `actions.jsonl` にも 1 行足す。
5. 日報の要点（3〜5 行）と、ユーザーに頼むことがあればその 1 行を、最後の返事に書く。

## アクション

実行してよいもの（1 日に公開の変更は **1 つまで**）。

- **らておの動画の説明欄に、案内ブロックを入れる・直す**（`yt-description.mjs`）。ブロックは「何が撮れるアプリか 1 行 ＋ `https://latte.makimura.me/yt`」。`/yt` が転送されること（`curl -sI https://latte.makimura.me/yt` が 302）を確かめてから使う。対象は、公開の動画だけ（アプリから上がった限定公開の練習動画には触らない。スクリプトも断る）。直した動画は、1 日 1 本ずつ、視聴の多い順に進める。効果は、`/yt` のアクセスで測る。
- **サイトや App Store の説明文の改善案を、PR にする**（マージはしない。審査中の版は、CLAUDE.md の「審査中は…」に従う）。
- **次に撮る動画・投稿の案を、日報に書く**（当たった動画の共通点から）。

やらないこと（いまの設定では、ユーザーの許可を待つ）。

- マージ、Worker のデプロイ、App Store Connect の送信・審査への提出、課金の発生
- 他人の動画へのコメント・リプライ、DM、広告。スパムにあたることはしない
- 事実でないことを書かない（機能・実績・評価・数字を盛らない）。説明文は、実際のアプリでできることだけ
- 秘密の値・メールアドレスを、リポジトリ・日報・PR に書かない（公開リポジトリ）

SNS（X など）への投稿は、アカウントと文面の方針が決まるまでは、案を日報に書くだけにする。決まったら、この節に足す。

## 戻し方

- 説明欄：`node scripts/daily/yt-description.mjs restore <動画ID>`（最後のバックアップに戻る）
- PR：閉じる

## 実行の環境

- 20:00 に、この Mac の Claude アプリで、定期実行のタスクとして動く（アプリが閉じていると、次に開いたときに動く）。タスクの名前は `latte-daily-growth`。
- 手順の更新は、この文書を直す（タスクの指示は、この文書を読むだけにしてある）。

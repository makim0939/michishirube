---
name: site-screenshots
description: 紹介サイト（worker/site/）やストアの説明に使う、アプリの実際の画面を高解像度で撮る手順。サイトの画面を撮り直すとき、型の見本・ホーム背景・アイコンを新しくしたあとに使う。
---

# 紹介サイトの画面の撮り方

置き場所：`worker/site/img/`（`today`・`cups`・`compare`・`tips`・`types`・`review` の `.webp`。`index.html` が読み込む）。
`src/site.test.ts` が、`index.html` の画像のファイルとリンクがそろっているかを確かめる。

## 撮り方（ユーザーの Chrome の Web 版で、運用データの画面を撮る）

claude-in-chrome（`mcp__claude-in-chrome__*`。ロードは `anthropic-skills:chrome-browser` のとおり、まとめて ToolSearch）。**新しいタブを作って使う。終わったら、自分が作ったタブを閉じる。**

1. 新しいタブで `https://makim0939.github.io/michishirube/` を開く。
2. JavaScript で、同じオリジンの iframe（幅 390×高さ 700）に Web 版を入れる（スマホ幅になる。IndexedDB の運用データも、同じオリジンなので見える）：
   ```js
   document.body.innerHTML = '<iframe src="/michishirube/" style="width:390px;height:700px;border:0;display:block;margin:0 auto;background:#faf7f2"></iframe>';
   document.body.style.cssText = 'margin:0;background:#ddd';
   document.documentElement.style.cssText = 'height:auto;overflow:hidden';
   ```
   （`resize_window` は、ウィンドウの大きさが思いどおりにならないことがある。iframe の方法なら、いつも幅 390 になる。）
3. 画面を、クリックで動かす。**座標は、iframe の位置（ウィンドウ幅から決まる）に注意。** iframe は、ウィンドウの中央に置かれる（幅 1440 なら x=525〜915、幅 500 なら x=55〜445）。まず `screenshot` で位置を確かめる。
4. `computer` の `zoom`（`region` に iframe の範囲、`save_to_disk: true`）で撮る。**`zoom` は、高解像度（2倍）の PNG を保存する**（`screenshot` は低い）。
5. **マウスカーソルが写り込む。** 撮る前に、`hover` で、iframe の外（例：`[1300, 300]`）へ動かす。下のタブバーにカーソルが残る画像は、タブバーごと切り取る。
6. スクロールバーが写るときは、背景色で塗りつぶす。
7. 切り取り：下のタブバーを除く（780×1272 ほど）。`PIL` で、`WEBP`（`quality=86`）にして `worker/site/img/` へ。
8. 見直す：**消える・変わる表示**（型の数「できた 2/10」、同梱の型の名前）を、画像に残さない。個人の情報（メールアドレス、アカウント名、日時のうち不要なもの）が写っていないか。

## 守ること

- **運用データは、見るだけ。** 編集画面を開いたら、保存せずに戻る。削除・保存の操作をしない（ユーザーが許可した範囲で）。
- 公開される画像なので、カップの写真以外の個人情報（家の中、顔、手など）が写っていないか確認する。動画のサムネイルは、使わない（手や部屋が写る）。
- 紹介サイトの文言・画像を変える PR は、Google の審査中は、大きな変更を避ける（`CLAUDE.md` の5章）。画像の差し替えは、問題ない。
- できたら、紹介サイトをブラウザペインで、スマホ幅とパソコン幅で確認する（スキル `verify-on-device`）。

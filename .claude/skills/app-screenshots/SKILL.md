---
name: app-screenshots
description: アプリの実際の画面を、きれいに撮る手順。紹介サイト・紹介記事・App Store の画面写真など、用途を問わず使う。画面を撮ってほしいと頼まれたとき、型の見本・ホーム背景・アイコンを新しくしたあとの撮り直しに使う。
---

# アプリの画面を撮る

用途ごとに、撮り方と、仕上げの形式が違う。まず、用途を確かめる。

| 用途 | 撮り方 | 仕上げ |
|---|---|---|
| 紹介サイト（`worker/site/img/`） | A：ユーザーの Chrome の Web 版（運用データ） | 780×1272 ほどの WebP（`quality=86`） |
| 紹介の記事・SNS・資料 | A（または B） | 用途に合わせた PNG・JPEG |
| App Store の画面写真 | C：実機の画面を変換（または B：iOS シミュレーター） | PNG・JPEG、**透明なし** |

## A. ユーザーの Chrome の Web 版（運用データの画面）

claude-in-chrome（`mcp__claude-in-chrome__*`）を使う。**新しいタブを作って使い、終わったら自分が作ったタブを閉じる。**

1. 新しいタブで `https://makim0939.github.io/michishirube/` を開く。
2. JavaScript で、同じオリジンの iframe（幅 390×高さ 700）に Web 版を入れる（スマホ幅になる。IndexedDB の運用データも、同じオリジンなので見える）：
   ```js
   document.body.innerHTML = '<iframe src="/michishirube/" style="width:390px;height:700px;border:0;display:block;margin:0 auto;background:#faf7f2"></iframe>';
   document.body.style.cssText = 'margin:0;background:#ddd';
   document.documentElement.style.cssText = 'height:auto;overflow:hidden';
   ```
   （`resize_window` は、ウィンドウの大きさが思いどおりにならないことがある。iframe の方法なら、いつも幅 390 になる。）
3. 画面を、クリックで動かす。iframe は、ウィンドウの中央に置かれる（幅 1440 なら x=525〜915、幅 500 なら x=55〜445）。まず `screenshot` で位置を確かめる。
4. `computer` の `zoom`（`region` に iframe の範囲、`save_to_disk: true`）で撮る。**`zoom` は、2倍の高解像度の PNG を保存する**（`screenshot` は低い）。
5. **マウスカーソルが写り込む。** 撮る前に、`hover` で iframe の外（例：`[1300, 300]`）へ動かす。下のタブバーにカーソルが残る画像は、タブバーごと切り取る。スクロールバーが写るときは、背景色で塗りつぶす。
6. 切り取り・WebP 化は `PIL`（`Image.crop` → `save(..., 'WEBP', quality=86, method=6)`）。

## B. iOS シミュレーター（App Store の画面写真）

1. `pnpm app:build` → `xcodebuild`（`CLAUDE.md` の確認の環境のとおり）→ シミュレーターに入れて起動する。`mcp__Claude_Code_iOS_Simulator__control` の `attach`・`launch` で、動かす。
2. 機種は、App Store の必要な大きさに合うものを選ぶ：iPhone（Dynamic Island のある機種）は 1179×2556 または 1206×2622、iPad 13インチは 2064×2752 または 2048×2732（`docs/app-store-submission.md` の6章。提出前に、App Store Connect の表記で確認する）。
3. 撮る：`xcrun simctl io booted screenshot <ファイル>.png`（機種のピクセル数のまま保存される。`control` の `screenshot` は縮小されることがあるので、ピクセル数を確認する）。
4. **透明をなくす**（`Image.open(...).convert('RGB')` で保存。App Store は、透明のある画像を受け付けない）。
5. 1枚ごとに、見せたい状態にしてから撮る（画面の並びは、`docs/app-store-submission.md` の案）。運用データは、見せてよいものだけ。

## C. 実機のスクリーンショットを App Store の大きさに変換する

ユーザーの iPhone・iPad の実機で撮った画面を、App Store の大きさに合わせる（ユーザーの機種：iPhone 12＝1170×2532、iPad Air 第4世代＝1640×2360）。

- 縦横比がほぼ同じ（iPhone）なら、画面全体が収まる倍率で拡大し、足りない数ピクセルを、**端の色で伸ばす**。
- 縦横比が違う（iPad）なら、高さに合わせて拡大し、左右を**端の色で伸ばす**。アプリは、中央の列と背景色の余白の作りなので、つなぎ目が目立たない（下のタブバーの白い帯も、行ごとに端の色が伸びるので、つながる）。

```python
import numpy as np
from PIL import Image

def to_appstore(src, target):  # target = (幅, 高さ)。例：(1179, 2556)、(2048, 2732)
    im = Image.open(src).convert('RGB')  # 透明なし
    tw, th = target
    s = min(tw / im.width, th / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    px, py = tw - im.width, th - im.height
    a = np.pad(np.asarray(im), ((py // 2, py - py // 2), (px // 2, px - px // 2), (0, 0)), mode='edge')
    return Image.fromarray(a)
```

- 大きさは、`docs/app-store-submission.md` の6章（提出前に、App Store Connect の表記で確認する）。
- ステータスバー（時刻・電池）が写る。気になる場合は、ユーザーに、時刻などを整えて撮ってもらうか、上の帯を、背景色で塗る。
- 個人情報（メールアドレス、アカウント名など）が写っていないか、確認する（設定 → アカウントは、使わない）。

## 共通の注意

- **運用データは、見るだけ。** 編集画面を開いたら、保存せずに戻る。削除・保存の操作をしない（ユーザーが許可した範囲で）。
- 公開される画像なので、個人情報（メールアドレス、アカウント名、家の中、顔、手）が写っていないか確認する。動画のサムネイルは、手や部屋が写るので、使わない。
- **消える・変わる表示**（同梱の型の名前・数など）が、画像に残っていないか。
- 型の見本・ホーム背景・アイコンを新しくしたら、画面の見た目がずれる。使っている画像を、撮り直す。

## 紹介サイトに使うとき

- 置き場所：`worker/site/img/`（`today`・`cups`・`compare`・`tips`・`types`・`review`）。`index.html` が読み込む。`src/site.test.ts` が、画像のファイルとリンクがそろっているかを確かめる。
- シェア用の画像 `worker/site/og.png`（1200×630）は、`today.webp` を使って作る。画面写真を撮り直したら、`python3 -I .claude/skills/app-screenshots/make-og.py worker/site` で作り直す（macOS のフォントを使う）。
- できたら、紹介サイトをブラウザペインで、スマホ幅とパソコン幅で確認する（スキル `verify-on-device`）。

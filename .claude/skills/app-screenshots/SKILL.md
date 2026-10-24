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
| App Store の画面写真 | C：実機の画面を撮り、`appstore-shot.py` で仕上げる（または B：iOS シミュレーター） | PNG、**透明なし**、状態バー 9:41・文字入り |

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

## D. プロダクトページ用に仕上げる（状態バーの差し替え・説明の文字）

実機（またはシミュレーター）で撮った画面を、フォルダに入れて、1コマンドで仕上げる：

```
python3 -I .claude/skills/app-screenshots/appstore-shot.py <撮った画像のフォルダ> <出力フォルダ>               # iPhone
python3 -I .claude/skills/app-screenshots/appstore-shot.py <撮った画像のフォルダ> <出力フォルダ> --device ipad  # iPad
```

- `<出力>/clean/`：状態バーを差し替えた、文字なしの画像。iPhone は 9:41・電波4本・電池満タン（1179×2556）、iPad は 9:41・1月9日(火)・電池満タン（2048×2732）。
- `<出力>/store/`：clean に、見出し・背景・枠を足した、App Store に出す画像。
- 見出し・順番・使う画像は、`appstore-captions.json`（`file` が撮った画像の名前。見出しの `{ }` で囲んだ字は茶色）。見出しは2行まで。文言を変えるときは、紹介サイトの言い方に合わせる。iPhone と iPad で同じものを使う。撮っていない画面は、飛ばして番号を詰める（iPad は 1 枚から出せる）。
- 最初の1枚（`"layout": "hero"`）だけは、撮った画面を使わず、アプリ自身の背景の写真（`public/world/light/morning.webp`）を大きく見せ、名前とサブタイトルを添える（参考にした他のアプリも、最初の1枚だけ別の見せ方だった）。アイコンは、写真とほぼ同じ絵（窓辺のロゼッタ）なので、出さない。2枚目以降は、上に見出し・下に画面の1パターン。
- 状態バーの差し替えは、iPhone は幅 1170 の画面（iPhone 12 など Dynamic Island のない機種）、iPad は幅 1640 の画面（iPad Air 第4世代・11 インチの機種）を前提にした位置。別の機種で撮ったら、`clean/` を見て、位置を確かめる。
- iPad で撮った画面の、次のものは、自動で消える：TestFlight から開いたときの「◀ TestFlight」、電池の残量の数字、右下のウインドウのつまみ（iPadOS 26）。状態バーの下が写真（今日の画面）のときは、すぐ下の写真を上下に折り返して埋める。
- 撮った画像ごとの手直しは、撮った画像のフォルダに `retouch.json` を置いて書く（スクリプトは、撮った画像そのものは書き換えない）。座標は、撮った画像のピクセル。機種ごとに分けて書く：

  ```json
  {
    "iphone": {
      "home": [{"tone": {"box": [0, 0, 1170, 1171], "gamma": 0.8, "saturation": 1.3,
                         "keep_color": [250, 247, 242], "keep_rows": 90, "keep_tol": 25}}],
      "pattern": [{"fill": {"box": [362, 345, 690, 480], "color": [250, 247, 242]}}]
    },
    "ipad": {"home": [{"tone": {"box": [140, 0, 1500, 834], "gamma": 0.8, "saturation": 1.3,
                                "keep_color": [250, 247, 242], "keep_rows": 90, "keep_tol": 25}}]}
  }
  ```

  - `tone`：`box` の中を明るく（`gamma` が 1 より小さいほど明るい）・鮮やかに（`saturation` 倍）する。夜に撮った、暗いホームの写真に使った。明るくすると鮮やかさが落ちるので、元より少し鮮やかになるくらいに `saturation` を上げる。`keep_rows` があれば、`box` の下の端からその行数の中だけ、`keep_color` に近い色（写真に重なるシートの角）は変えない。
  - `fill`：`box` の中を一色で塗る。データの都合で出た、実際には出ない表示（重複した分野のタブなど）を消すときに使う。
- 仕上げた画像と、撮った画像・`retouch.json` は、版ごとに `references/appstore-screenshots/` に残す（1.1 は `raw-1.1`・`raw-1.1-ipad` → `v8`・`v8-ipad`）。同じコマンドで、作り直せる。
- シミュレーターで撮るなら、撮る前に `xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3`、終わったら `xcrun simctl status_bar booted clear`。
- 出力は `references/`（git に入れない）に置く。

## 共通の注意

- **運用データは、見るだけ。** 編集画面を開いたら、保存せずに戻る。削除・保存の操作をしない（ユーザーが許可した範囲で）。
- 公開される画像なので、個人情報（メールアドレス、アカウント名、家の中、顔、手）が写っていないか確認する。動画のサムネイルは、手や部屋が写るので、使わない。
- **消える・変わる表示**（同梱の型の名前・数など）が、画像に残っていないか。
- 型の見本・ホーム背景・アイコンを新しくしたら、画面の見た目がずれる。使っている画像を、撮り直す。

## 紹介サイトに使うとき

- 置き場所：`worker/site/img/`（`today`・`cups`・`compare`・`tips`・`types`・`review`）。`index.html` が読み込む。`src/site.test.ts` が、画像のファイルとリンクがそろっているかを確かめる。
- シェア用の画像 `worker/site/og.png`（1200×630）は、`today.webp` を使って作る。画面写真を撮り直したら、`python3 -I .claude/skills/app-screenshots/make-og.py worker/site` で作り直す（macOS のフォントを使う）。
- できたら、紹介サイトをブラウザペインで、スマホ幅とパソコン幅で確認する（スキル `verify-on-device`）。

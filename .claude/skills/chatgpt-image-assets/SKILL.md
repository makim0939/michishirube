---
name: chatgpt-image-assets
description: ChatGPT で、アプリの絵（型の見本・記録がないときのホーム背景・アイコン）を作ってもらう依頼の用意と、できあがった画像をアプリに組み込む手順。絵を作り直す、ChatGPT に渡す依頼文・入力画像を作る、受け取った画像を public/world/ に入れるときに使う。
---

# ChatGPT で作る絵 → アプリへの組み込み

役割分担：**絵は、ユーザーが ChatGPT で作る**（Claude には、画像を新しく生成する手段がない。ChatGPT は **1日5枚弱**しか作れないので、数日かけて進める）。
Claude は、依頼文と入力画像の用意、できあがりの確認、アプリへの加工と組み込み、PR、画面確認をする。

## 決まったスタイル

- 雰囲気は、いまの**やわらかいイラスト調**。写真にはしない。
- **粒子感・ざらざらしたテクスチャは残す**（ユーザーが気に入っている）。消すのは、ぼやけ・にじみ・圧縮の劣化だけ。
- **ラテアートの形だけ、よりリアルに。** シルエット・向き・位置・大きさは入力のまま。線や縁は、ミルクが流れたような有機的な形にする。
- 使っていない型（ウェーブ・チューリップ3段・ドット・模様なし）の絵は作らない。
- 型の見本の基準画像（ロゼッタ）：真上から、取っ手は右下、ソーサーあり、木のテーブル（影なし）。ユーザーが合意した（`references/latte-image-request/approved/rosetta-base.png`。git には入っていない。無ければ、ユーザーに頼む）。2枚目以降は、**この基準画像と、その型の入力画像の2枚を添付して**頼む（カップ・ソーサー・木・光・質感・画角を、完全にそろえて、模様だけを差し替えてもらう）。

## 依頼文のひな形

`prompts/` にある（そのまま ChatGPT に貼れる。中の `input/…` は、用意する入力画像のパス）：

- `prompts/patterns.md`：型の見本 6 種類（ロゼッタ・ハート・チューリップ・レイヤーハート・ウイングチューリップ・スワン）
- `prompts/icon.md`：アプリのアイコン
- `prompts/home-background.md`：記録がないときのホーム背景（朝・昼・夕・夜）

進め方：最初の1枚でスタイルを決め、同じチャットで1枚ずつ頼む（まとめて頼むと構図がずれる）。模様の形が入力と違えば、作り直してもらう。

## 入力画像の用意

現在の画像（`public/world/patterns/*.webp`＝320px、`public/world/light/*.webp`＝780×860）を、1024px に拡大して、`references/<フォルダ>/input/` に置く（git に入れない）。一覧（`00-all.png`）も作る。

```python
from PIL import Image
Image.open('public/world/patterns/rosetta.webp').convert('RGB').resize((1024, 1024), Image.LANCZOS).save('references/<フォルダ>/input/01-rosetta.png')
```

依頼文は `references/<フォルダ>/prompt.md` として置き、ユーザーが取り出しやすいよう zip にして渡す（`SendUserFile`）。

## できあがりを受け取ったら

1. **そろっているか確認する**：6枚（または4枚）を並べて、カップ・ソーサーの位置・大きさ・取っ手の向き・色合い・木目が同じか。模様のシルエットが入力と同じか。ずれが大きければ、ユーザーに、ChatGPT で頼み直してもらう。
2. 受け取った PNG を、フォルダにまとめ、**名前を `rosetta.png`・`heart.png`・`tulip2.png`・`layerheart.png`・`wing.png`・`swan.png`（ホーム背景は `morning.png`・`noon.png`・`evening.png`・`night.png`）にする**。
3. スクリプトで、アプリの大きさにして入れる：
   ```bash
   python3 -I .claude/skills/chatgpt-image-assets/integrate_images.py patterns <フォルダ> --preview <scratch>/pat.png
   python3 -I .claude/skills/chatgpt-image-assets/integrate_images.py light <フォルダ> --preview <scratch>/light.png
   ```
   - patterns：カップ＋ソーサーの周りを、**全画像で同じ範囲**で切り出し（`--crop`・`--center`。既定は、基準画像で測った値）、640px の WebP にして `public/world/patterns/` に入れる。**プレビューの下段（56px の丸・104px の正方形）で、模様が読み取れるか、丸の切り抜きで欠けないか**を見る。ずれていたら、`--crop`・`--center` を調整する。
   - light：中央を 780:860 の縦長に切り出して `public/world/light/` に入れる。
   - `--dry-run`：作るファイルの一覧だけ。`--root`：別のフォルダに作る（試すとき）。
4. 使われ方：型の見本は `src/ui/world.ts` の `patternFor`（型の名前 → 絵）・`PatternImage.tsx`（型の一覧の角丸、ホームの型のカードの丸、型の画面）。ホーム背景は `TodayScreen.tsx` が `lightUrl(light)` で使う（写真が無いとき）。**画面で見て確かめる**（スキル `verify-on-device`）：カップが切れていないか、文字・カードと重なっても見やすいか。
5. アイコンは、別のスキル `app-icon`。
6. PR（スキル `worktree-pr`）。画像を差し替えたら、**紹介サイトの画面写真**（`worker/site/img/`）も、見た目がずれる。撮り直す（スキル `site-screenshots`）。

## 守ること

- **審査中は、紹介サイトのアイコン・Google のブランディングのロゴを変えない**（`app-icon` を参照）。アプリの中の画像（型の見本・ホーム背景）は、変えてよい。
- 他人が撮った写真（`references/` の「ロゼッタ.jpeg」など）を、ChatGPT への入力に含めない。入力は、アプリで使っている画像だけ。
- `references/` はコミットしない。

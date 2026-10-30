# 同梱のフォント

動画に重ねるテキスト（`src/domain/textOverlay.ts`）のフォント。`public/fonts/` に、ライセンス（SIL Open Font License 1.1）の全文と一緒に置く。
アプリの中に同梱し、使うときだけ読み込む（外から取らない）。動画への焼き込みは、OFL で許される（フォント自体を、単体で売らなければよい）。

| 役割 | フォント | ファイル | 大きさ | 備考 |
|---|---|---|---|---|
| 手書き | Yusei Magic | `YuseiMagic-Regular.woff2` | 約 0.41 MB | ひらがな・カタカナ・記号・英数字・JIS 第 1 水準漢字だけに絞った。Reserved Font Name なし |
| セリフ | Playfair Display | `PlayfairDisplay.woff2` | 約 0.10 MB | 英数字・記号だけ（日本語は、標準の明朝で描く）。Reserved Font Name 付き：字は削らず、形式（TTF→woff2）の変換だけ |
| セリフ斜体 | Playfair Display Italic | `PlayfairDisplay-Italic.woff2` | 約 0.10 MB | 同上 |
| 細字（大文字） | Josefin Sans | `JosefinSans.woff2` | 約 0.05 MB | 英数字・記号だけ。字間を広げ、英字を大文字にして描く。Reserved Font Name 付き：同上 |

ゴシック・丸ゴシック・明朝は、iPhone・iPad 標準のヒラギノで、同梱しない（Android・Web には、ヒラギノが無いので、後ろの候補で描く。この画面は、いまは iPhone・iPad だけ）。
フォントを足す・替えるときは、`public/fonts/` に、woff2 と OFL 全文を置き、この表と `README.txt`、`src/styles.css` の `@font-face`、`TEXT_FONTS` を更新する。

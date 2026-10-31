# BGM（動画の仕上げ）

「仕上げる」画面（記録の編集 → 動画 → 仕上げる）で、動画に BGM を足せる。元の動画の音はそのままで、BGM は動画の長さまで繰り返し、終わりの 1.5 秒で小さくなる。BGM の行を押すと、下から曲の一覧（なし・同梱の曲・ファイルから選ぶ）が開き、曲の行の ▶ で聴ける。選ぶと閉じて、音量（0〜100 %）のスライダーが出る。書き出しは `VideoComposer` プラグイン（iOS・Android）。コードは `src/data/bgm.ts`・`src/ui/Composer.tsx`。

## 曲の出どころ

- **ファイルから選ぶ**（今できる）：利用者が、自分の端末にある曲を選ぶ。**YouTube オーディオライブラリの曲も、Studio でダウンロードして、ここから選べる**。権利は利用者の責任（YouTube に上げると、市販の曲は Content ID で申し立てを受けうる。オーディオライブラリの曲は、YouTube 上では受けない：[YouTube ヘルプ](https://support.google.com/youtube/answer/3376882)）。ファイルの曲は、動画より短いとき、頭から繰り返すが、継ぎ目を整える処理はしない（同梱の曲だけ）
- **同梱の曲**（今は 6 曲）：CC0 か自作だけ。YouTube オーディオライブラリの曲は、再配布の許可の根拠が無いので、同梱しない。**クレジット表記が要るライセンス（CC BY など）は、動画に焼き込んで配られるので、同梱しない**

| ファイル | 名前（画面） | 出典・作った人 | ライセンス | 確認日 | 大きさ・繰り返し 1 回分 |
|---|---|---|---|---|---|
| `dreams-of-tomorrow.m4a` | Dreams of Tomorrow | Open Music Academy「Dreams of Tomorrow (Lofi)」Ludwig Orel | CC0 | 2026-10-31 | 0.4 MB・0:27 |
| `playful-toy.m4a` | Playful Toy | Open Music Academy「Playful Toy LoFi」 | CC0 | 2026-10-31 | 0.4 MB・0:22 |
| `cosy-feeling.m4a` | Cosy Feeling | Open Music Academy「Cosy Kind Of Feeling (Jazztrio) Loopable」Johannes Söllner | CC0 | 2026-10-31 | 0.6 MB・0:37 |
| `quiet-days.m4a` | Quiet Days | Open Music Academy「Quiet Days (Lo-Fi)」Florian Simon | CC0 | 2026-10-31 | 0.4 MB・0:24 |
| `8bit-bossa.m4a` | 8bit Bossa | OpenGameArt「Bossa Nova」（ファイル名 8bit Bossa.mp3）Joth。2016-08-28 公開 | CC0 | 2026-10-31 | 1.0 MB・0:60 |
| `april-groove.m4a` | April Groove | Open Music Academy「April Groove (Jazz)」Florian Simon | CC0 | 2026-10-31 | 0.5 MB・0:31 |

- **Open Music Academy の曲**（ミュンヘン音楽演劇大学の教材サイト）：集めたページ [CC0 Hintergrundmusik / CC0 Background Music](https://openmusic.academy/docs/PhjRHKrMCa9wXaMeFwhQrK/cc0-hintergrundmusik) に、「CC0 のライセンスで、著作権の制限が無い」と書かれ、上の 5 曲がこの一覧に載っている。ファイルの ID3（アルバム「Open Music Academy CC0-Tracks」・作者名に「CC0」）も同じ。曲は、ユーザーが 2026-10-30〜31 に、この一覧から取得した。曲ごとのページは、画面の表示が動的で、機械的には読めないので、**一覧のページの表示に依拠する**。万一の申し立てに備え、出典の URL と確認日を、ここに残す
- **8bit Bossa**：OpenGameArt のページ（https://opengameart.org/content/bossa-nova ）の、ライセンス欄が CC0、作者 Joth（2026-10-31 に確認）。別のサイトで、別の作者名で載せているところもあるが、OpenGameArt の投稿者は Joth（ライセンスは、どちらも CC0）
- **並び順**：ユーザーが付けた星の順（⭐️3 → ⭐️2 → ⭐️1）。落ち着いた順ではなく、ユーザーの好みを優先した
- **同梱の増加**：全部で約 **3.3 MB**（アプリ（iOS・Android）の中に入る。Web 版の PWA の事前取り込みには入れない：`vite.config.ts` の `globPatterns` に m4a が無い。BGM を選んだときだけ、ネットから取る）
- **Android**：曲は、同じものが使えるが、Android は「仕上げる」（編集画面）を開けない（`canJoinVideos` が iOS だけ）ので、BGM を選ぶ導線は、今は無い

## 曲の加工（つなぎ目なく繰り返すため）

動画は、曲より長いことが多く、曲を頭から繰り返す。**「数字が合っている」ではなく、音楽として（拍・小節・和声・フレーズ）つながる**ことが目的。実機で聴いて、曲によって、つなぎ目が分かる・曲が繋がっていない、という報告があり、原因は次のとおりだった：

- 元の曲（MP3）の多くは、**整数小節（16 小節など）の長さで書き出された、ループ向けのファイル**（Playful Toy は 160 BPM・16 小節＝ちょうど 24.000 秒、Quiet Days は 120 BPM・16 小節＝32.000 秒）。それなのに、最初の加工は、無音を詰めたあと、「拍の形が合う所」を探して**小節の途中（Playful Toy は 14.67 小節、8bit Bossa は 30.5 小節、Dreams of Tomorrow は 7.5 小節、April Groove は 14.96 小節）で切って**、終わりを頭に重ねていた。小節の頭が半拍〜数拍ずれ、頭に別の拍の音が重なって二重に聞こえ、和声の区切り（コード進行・フレーズ）もずれる。Quiet Days（12 小節）と Cosy Feeling（16 小節）は、たまたま（または、ループ用に作られていて）小節の整数倍だったので、問題がなかった

そこで、加工は 2 つの方式にした（`scripts/make-bgm.py`、macOS・ffmpeg・numpy）：

- **bars（整数小節で切る）**：曲のテンポ（BPM）から 1 小節の長さを決め、**音の始まりから整数小節ぶん**を、そのまま 1 周分にする。終わりから頭へ戻っても、拍・小節・和声が、曲の中の「小節から次の小節」と同じように続く。重ねる処理はしない。1 周分のあとに、ファイルに余韻（リバーブの残り）が続いているときだけ、その余韻を頭に足す（テールのオーバーラップ。頭の最初の 2 ms だけ立ち上げて、終わりから頭へ段差なくつなぐ）。イントロ・アウトロは、`skip_bars`・`bars` で外す
- **legacy（終わりを頭に重ねる）**：もとの方式（終わりの X 秒を、頭の X 秒に重ねる。等パワーのクロスフェード）。Cosy Feeling（Loopable。重ねは 30 ms だけ）と Quiet Days は、実機で違和感がなかったので、**音を変えないために残した**（作り直しても、音のデータは、前と完全に同じ）

どちらも、音量をそろえる（-16 LUFS・ピーク -1 dB）→ AAC 128 kbps の m4a（**afconvert**。ffmpeg の AAC は、終わりの余白（最大 1024 サンプル。約 20 ms）の長さを書かないので、繰り返すたびに短い無音が入る。afconvert は余白の長さも書くので、iOS の AVFoundation が、ぴったり繰り返す）。

### 曲ごとの設定（`TRACKS`）

BPM は、onset の自己相関と、拍の格子の当てはめ（librosa・numpy）で求め、曲の長さが整数小節になることで裏付けた。

| 曲 | 方式 | BPM | 1 周 | 元のファイルでの位置 |
|---|---|---|---|---|
| Playful Toy | bars | 160 | 16 小節＝24.000 秒 | ファイル全体（頭から。4 小節の繰り返しが 4 回） |
| April Groove | bars | 125 | 16 小節＝30.720 秒 | ファイル全体 |
| 8bit Bossa | bars | 129 | 32 小節＝59.535 秒 | ファイル全体（音の始まり 6 ms から）。長いが、半分（16 小節）で切るより、作曲者の 32 小節のまま回したほうが、繋がりが確実 |
| Dreams of Tomorrow | bars | 70 | 8 小節＝27.429 秒 | 5〜12 小節目。1〜4 小節目は、音が小さく薄いイントロ（ループに向かない）。12 小節目のあとの約 5 秒は、最後の和音のリバーブなので、頭に足す |
| Cosy Feeling | legacy | 105 | 36.54 秒 | （Loopable。もとのまま） |
| Quiet Days | legacy | 120 | 24.0 秒 | （もとのまま。12 小節） |

### 確かめる

`python3 scripts/check-bgm-seam.py public/bgm/*.m4a`（`--out <フォルダ>` を付けると、**2 周分をつなげた wav・継ぎ目の前後の onset の時刻・継ぎ目をまたぐ 10 秒の波形とスペクトログラムの画像**も出す。画像は matplotlib があれば）。継ぎ目の値を、**曲の中の同じ測り方の値**と並べて出す（曲の中にも、スウィングの揺れや音色の変化はあるので、同じ範囲なら、つながっている）：

- 1 周の長さが、小節の整数倍か（ずれ ms）
- 拍の位相：継ぎ目の前後 4 秒の onset が、拍の格子（16 分音符）から何 ms ずれるか
- リズムの似かた：k 小節（1・2・4）の前後の、onset の強さの形の相関
- onset の間隔の列（ms）：継ぎ目をまたぐ間隔が、前後と同じ拍の割りに乗っているか
- スペクトルの違い（音色が途切れていないか）・和声（クロマ）の似かた・大きさ・段差（クリック）

数値は、必要な条件であって、十分ではない。**耳で聴く**（下の手順 7）。

- **書き出し（iOS）の確かめ**：`VideoComposerPlugin.swift` と同じ並べ方（m4a の duration ずつ並べる）を AVFoundation で 300 秒ぶん作り、各周の位置を、頭の周との相互相関で比べると、すべての継ぎ目で、ずれは 0 サンプル（duration は、1 周分＝小節の整数倍に一致：afinfo の valid frames で 24.000・30.720・27.429・59.535 秒）。iOS シミュレーターでの実際の書き出し（映像つき）は、まだ見ていない

## 曲を足す・差し替える手順

1. 元の曲（MP3 など）を、`references/lattecho-bgm/` に置く。**ライセンスを確かめる**：CC0 か自作だけ（出典のページで、ライセンスの表示を読む。作者が宣言していない「CC0」の表示は、頼らない）。クレジット表記が要るものは入れない
2. 曲のテンポを分析して（BPM と、1 周を何小節にするか。元のファイルが整数小節の長さなら、ファイル全体。イントロ・アウトロがあれば `skip_bars`・`bars` で外す）、`scripts/make-bgm.py` の `TRACKS` に足す（`method: "bars"`。Loopable で、もともと継ぎ目が合っている曲だけ `legacy`）。置き換えるときは、不要な行を消す
3. 実行する（新しい m4a が、`public/bgm/` に出る。古い曲の m4a は、手で消す）：

```bash
python3 scripts/make-bgm.py references/lattecho-bgm public/bgm
python3 scripts/check-bgm-seam.py public/bgm/*.m4a
```

4. `src/data/bgm.ts` の `BUNDLED_BGM` に足す（`id`・`title`・`path`・`seconds`＝上の実行で出る「seconds」）
5. 上の表に、出典・ライセンス・確認日・大きさを書く
6. （任意）書き出しの継ぎ目：上の「書き出し（iOS）の確かめ」。5 分の動画に BGM を付けて書き出し（iOS シミュレーター）、音を取り出して、繰り返し 1 回分（有効な長さ）ごとに、元の曲との位置のずれ（相互相関）と、継ぎ目の段差・無音を見る
7. 画面で、曲を選んで、聴く（シートの ▶・選んだあとの再生）。曲が 1 周して頭に戻る所で、拍が途切れないか・和音が不自然に飛ばないか・余韻が切れないか、を耳で確かめる。`check-bgm-seam.py --out` の `…-loop2.wav`（2 周分）を聴くのも手

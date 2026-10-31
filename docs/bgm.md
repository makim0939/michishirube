# BGM（動画の仕上げ）

「仕上げる」画面（記録の編集 → 動画 → 仕上げる）で、動画に BGM を足せる。元の動画の音はそのままで、BGM は動画の長さまで繰り返し、終わりの 1.5 秒で小さくなる。BGM の行を押すと、下から曲の一覧（なし・同梱の曲・ファイルから選ぶ）が開き、曲の行の ▶ で聴ける。選ぶと閉じて、音量（0〜100 %）のスライダーが出る。書き出しは `VideoComposer` プラグイン（iOS・Android）。コードは `src/data/bgm.ts`・`src/ui/Composer.tsx`。

## 曲の出どころ

- **ファイルから選ぶ**（今できる）：利用者が、自分の端末にある曲を選ぶ。**YouTube オーディオライブラリの曲も、Studio でダウンロードして、ここから選べる**。権利は利用者の責任（YouTube に上げると、市販の曲は Content ID で申し立てを受けうる。オーディオライブラリの曲は、YouTube 上では受けない：[YouTube ヘルプ](https://support.google.com/youtube/answer/3376882)）。ファイルの曲は、動画より短いとき、頭から繰り返すが、継ぎ目を整える処理はしない（同梱の曲だけ）
- **同梱の曲**（今は 6 曲）：CC0 か自作だけ。YouTube オーディオライブラリの曲は、再配布の許可の根拠が無いので、同梱しない。**クレジット表記が要るライセンス（CC BY など）は、動画に焼き込んで配られるので、同梱しない**

| ファイル | 名前（画面） | 出典・作った人 | ライセンス | 確認日 | 大きさ・繰り返し 1 回分 |
|---|---|---|---|---|---|
| `dreams-of-tomorrow.m4a` | Dreams of Tomorrow | Open Music Academy「Dreams of Tomorrow (Lofi)」Ludwig Orel | CC0 | 2026-10-31 | 0.4 MB・0:26 |
| `playful-toy.m4a` | Playful Toy | Open Music Academy「Playful Toy LoFi」 | CC0 | 2026-10-31 | 0.4 MB・0:22 |
| `cosy-feeling.m4a` | Cosy Feeling | Open Music Academy「Cosy Kind Of Feeling (Jazztrio) Loopable」Johannes Söllner | CC0 | 2026-10-31 | 0.6 MB・0:37 |
| `quiet-days.m4a` | Quiet Days | Open Music Academy「Quiet Days (Lo-Fi)」Florian Simon | CC0 | 2026-10-31 | 0.4 MB・0:24 |
| `8bit-bossa.m4a` | 8bit Bossa | OpenGameArt「Bossa Nova」（ファイル名 8bit Bossa.mp3）Joth。2016-08-28 公開 | CC0 | 2026-10-31 | 0.9 MB・0:57 |
| `april-groove.m4a` | April Groove | Open Music Academy「April Groove (Jazz)」Florian Simon | CC0 | 2026-10-31 | 0.5 MB・0:29 |

- **Open Music Academy の曲**（ミュンヘン音楽演劇大学の教材サイト）：集めたページ [CC0 Hintergrundmusik / CC0 Background Music](https://openmusic.academy/docs/PhjRHKrMCa9wXaMeFwhQrK/cc0-hintergrundmusik) に、「CC0 のライセンスで、著作権の制限が無い」と書かれ、上の 5 曲がこの一覧に載っている。ファイルの ID3（アルバム「Open Music Academy CC0-Tracks」・作者名に「CC0」）も同じ。曲は、ユーザーが 2026-10-30〜31 に、この一覧から取得した。曲ごとのページは、画面の表示が動的で、機械的には読めないので、**一覧のページの表示に依拠する**。万一の申し立てに備え、出典の URL と確認日を、ここに残す
- **8bit Bossa**：OpenGameArt のページ（https://opengameart.org/content/bossa-nova ）の、ライセンス欄が CC0、作者 Joth（2026-10-31 に確認）。別のサイトで、別の作者名で載せているところもあるが、OpenGameArt の投稿者は Joth（ライセンスは、どちらも CC0）
- **並び順**：ユーザーが付けた星の順（⭐️3 → ⭐️2 → ⭐️1）。落ち着いた順ではなく、ユーザーの好みを優先した
- **同梱の増加**：全部で約 **3 MB**（アプリ（iOS・Android）の中に入る。Web 版の PWA の事前取り込みには入れない：`vite.config.ts` の `globPatterns` に m4a が無い。BGM を選んだときだけ、ネットから取る）
- **Android**：曲は、同じものが使えるが、Android は「仕上げる」（編集画面）を開けない（`canJoinVideos` が iOS だけ）ので、BGM を選ぶ導線は、今は無い

## 曲の加工（つなぎ目なく繰り返すため）

動画は、曲より長いことが多く、曲を頭から繰り返す。曲の終わりで静かになってから頭が始まると、間があく。そこで、同梱の曲は、**終わりを頭に重ねた、繰り返し用のファイル**にして置く。元の曲（MP3）は、git に入れず、`references/lattecho-bgm/` に残す。

- 加工は `scripts/make-bgm.py`（macOS・ffmpeg・numpy）：頭と終わりの無音を詰める → 曲を切る位置 N を探す（N のあとの X 秒が、頭の X 秒と拍の形が合い、まだ音が鳴っている所。余韻や無音にかかる所は避ける） → N のあとの X 秒を、頭の X 秒に重ねる（等パワーのクロスフェード。長さは N になる）→ 音量をそろえる（-16 LUFS・ピーク -1 dB）→ AAC 128 kbps の m4a。N の直前の音の次に、元の曲の N の音が続くので、終わりから頭へ戻るところで、音が飛ばない
- **ループとして作られた曲（ファイル名に Loopable）**は、もともと継ぎ目が合っているので、重ねは 30 ms だけ（クリック防止）
- **m4a の変換は afconvert**（macOS）。ffmpeg の AAC は、終わりの余白（最大 1024 サンプル。約 20 ms）の長さを書かないので、繰り返すたびに短い無音が入る。afconvert は余白の長さも書くので、iOS の AVFoundation が、ぴったり繰り返す
- 画面（Web の audio）は、`AudioBufferSourceNode` の loop で流す（audio 要素の loop は、継ぎ目に短い間があく）：`src/data/bgmPlayer.ts`。書き出し（iOS）は、同じ m4a を、動画の長さまで並べる：`VideoComposerPlugin.swift`。どちらも、同じファイルを、同じ長さ（有効な長さ）で繰り返す
- 確かめる：`python3 scripts/check-bgm-seam.py public/bgm/*.m4a`（継ぎ目の前後の大きさ・段差を、曲の中の値と比べる。拍の間で小さくなる曲は、曲の中の値も小さい）

## 曲を足す・差し替える手順

1. 元の曲（MP3 など）を、`references/lattecho-bgm/` に置く。**ライセンスを確かめる**：CC0 か自作だけ（出典のページで、ライセンスの表示を読む。作者が宣言していない「CC0」の表示は、頼らない）。クレジット表記が要るものは入れない
2. `scripts/make-bgm.py` の `TRACKS` に足す（id・元のファイルの場所・重ねる秒数。Loopable なら 0.03）。置き換えるときは、不要な行を消す
3. 実行する（新しい m4a が、`public/bgm/` に出る。古い曲の m4a は、手で消す）：

```bash
python3 scripts/make-bgm.py references/lattecho-bgm public/bgm
python3 scripts/check-bgm-seam.py public/bgm/*.m4a
```

4. `src/data/bgm.ts` の `BUNDLED_BGM` に足す（`id`・`title`・`path`・`seconds`＝上の実行で出る「seconds」）
5. 上の表に、出典・ライセンス・確認日・大きさを書く
6. （任意）書き出しの継ぎ目：5 分の動画に BGM を付けて書き出し（iOS シミュレーター）、音を取り出して、繰り返し 1 回分（有効な長さ）ごとに、元の曲との位置のずれ（相互相関）と、継ぎ目の段差・無音を見る。Dreams of Tomorrow で確かめた結果：11 回の継ぎ目すべてで、ずれは ±2 サンプル以内（累積しない）、継ぎ目の 20 ms ごとの大きさは曲の中と同じ（無音なし）、段差は曲の中の段差の範囲
7. 画面で、曲を選んで、聴く（シートの ▶・選んだあとの再生）。つなぎ目を、頭と終わりが重なる所で、耳で確かめる。5 分の動画で書き出して、継ぎ目の前後を数字で見るなら、`ffmpeg` で書き出した音を `scripts/check-bgm-seam.py` に近い見方で調べる

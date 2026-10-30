# BGM（動画の仕上げ）

「仕上げる」画面（記録の編集 → 動画 → 仕上げる）で、動画に BGM を足せる。元の動画の音はそのままで、BGM は動画の長さまで繰り返し、終わりの 1.5 秒で小さくなる。書き出しは `VideoComposer` プラグイン（iOS・Android）。コードは `src/data/bgm.ts`・`src/ui/Composer.tsx`。

## 曲の出どころ

- **ファイルから選ぶ**（今できる）：利用者が、自分の端末にある曲を選ぶ。**YouTube オーディオライブラリの曲も、Studio でダウンロードして、ここから選べる**。権利は利用者の責任（YouTube に上げると、市販の曲は Content ID で申し立てを受けうる。オーディオライブラリの曲は、YouTube 上では受けない：[YouTube ヘルプ](https://support.google.com/youtube/answer/3376882)）。
- **同梱の曲**（今は 6 曲）：CC0 か自作だけ。YouTube オーディオライブラリの曲は、再配布の許可の根拠が無いので、同梱しない。

## 同梱の曲を足すとき

1. 曲を `public/bgm/` に置く（AAC の m4a。1 曲 1〜2 MB、30 秒〜2 分ほど。つなぎ目なく繰り返せる曲が向く）。
2. `src/data/bgm.ts` の `BUNDLED_BGM` に足す（`id`・`title`・`path`＝`bgm/xxx.m4a`）。
3. 下の表に、出典・ライセンス・取得日（自作は、作った人と日付）を書く。第三者の CC0 は、他人が Content ID に登録している場合があるので、出典の URL と取得日を残す（申し立てへの異議の根拠になる）。公開リポジトリに入るので、再配布できるライセンスだけ。

| ファイル | 名前（画面） | 出典・作った人 | ライセンス | 取得日 | 大きさ・長さ |
|---|---|---|---|---|---|
| `poor-but-happy.m4a` | Poor But Happy | Holizna「Happy Lo-Fi (Lofi Collection)」の「Poor But Happy」 | CC0 | 2026-10-29 | 1.3 MB・2:07 |
| `blue-skies.m4a` | Blue Skies | 同「Blue Skies」 | CC0 | 2026-10-29 | 1.8 MB・2:52 |
| `puppy-love.m4a` | Puppy Love | 同「Puppy Love」 | CC0 | 2026-10-29 | 1.5 MB・2:28 |
| `clouds.m4a` | Clouds | 同「Clouds」 | CC0 | 2026-10-29 | 2.4 MB・3:49 |
| `letting-go.m4a` | Letting Go | 同「Letting Go Of The Past」 | CC0 | 2026-10-29 | 1.8 MB・2:58 |
| `a-little-off.m4a` | A Little Off | 同「Happy but a little off」 | CC0 | 2026-10-29 | 1.2 MB・1:57 |

- **出典**：作者 Holizna（HoliznaCC0）の「Happy Lo-Fi (Lofi Collection)」。配布は OpenGameArt のページ（https://opengameart.org/content/happy-lo-fi-lofi-collection 。曲は 2026-10-29 に探してダウンロード。CC0 の表示は、このページ（ライセンス欄 CC0、作者の注記「public domain CC0」）で確認した）。作者のページ（Bandcamp）には、CC BY 4.0 の表示があるが、作者の文面は CC0 とされており、**OpenGameArt の CC0 の表示に依拠する**。万一の申し立てに備え、出典の URL と取得日を、ここに残す
- **変換**：元の MP3 から、AAC（m4a）に変換（ffmpeg。80 kbps・ステレオ・44.1 kHz。頭と終わりの無音を詰め、音量をそろえた：`loudnorm` I=-16 LUFS）。同梱の増加：**約 10 MB**（6 曲の合計。アプリ（iOS・Android）の中に入る。Web 版の PWA の事前取り込みには入れない：`vite.config.ts` の `globPatterns` に m4a が無い。BGM を選んだときだけ、ネットから取る）
- **つなぎ目**：曲は、動画の長さまで、頭から繰り返す（終わりの 1.5 秒で小さくしていく）。曲の終わりは静かに小さくなり、頭から始まるので、つなぎ目は、短く静かになってから、頭の音が始まる（途切れる音・クリックは無い）
- **並び順**：落ち着いた順（Poor But Happy・Blue Skies・Puppy Love・Clouds・Letting Go・A Little Off）
- **Android**：曲は、同じものが使えるが、Android は「仕上げる」（編集画面）を開けない（`canJoinVideos` が iOS だけ）ので、BGM を選ぶ導線は、今は無い

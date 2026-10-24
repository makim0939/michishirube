# バージョンの決め方

アプリの版は、**`package.json` の `version`（x.y.z）を1つの正**にする。設定の画面の「ラテ帳 v◯」、ご意見・ご要望に付く版は、これを読む（`vite.config.ts`）。
iOS の `MARKETING_VERSION`（`ios/App/App.xcodeproj/project.pbxproj`。Debug・Release の2か所）は、同じ数字にそろえる（`1.0.0` と `1.0` は同じ版として数える）。ずれると、テスト（`src/version.test.ts`）が落ちる。
Android の `versionName` は、`-PversionName` を渡さなければ `package.json` の `version` を読む（`android/app/build.gradle`）ので、そろえる作業はない。

## 数字の上げ方

| 上げるもの | いつ | 例 |
|---|---|---|
| メジャー（x） | 使い方や、データの持ち方が大きく変わるとき。ストアで「新しい版」として紹介したいとき | 1.0.0 → 2.0.0 |
| マイナー（y） | 新しい機能・画面の変更を足すとき | 1.0.0 → 1.1.0 |
| パッチ（z） | 不具合の修正・文言・見た目の手直しだけのとき | 1.1.0 → 1.1.1 |

- **ストアに出さない変更（紹介サイト・サーバーだけ、など）では、版を上げない。**
- 版を上げるのは、リリースの準備のとき（ストアに出す前）。ふだんの PR では触らない。
- 上げたら、`package.json` と iOS を同じ PR で変える（Android は自動）。

## ビルド番号（iOS の `CURRENT_PROJECT_VERSION`・Android の `versionCode`）

- 版とは別に、**ストアに送るたびに1つ上げる**（同じ版の作り直しでも、上げないと受け付けられない）。
- 版を上げたあとも、リセットしない（増やし続ける）。
- ふだんは 1 のまま。実際に送るとき（`docs/app-store-submission.md` の手順 4）に上げる。
- GitHub Actions から TestFlight に上げるときは、Xcode が、App Store Connect の最後の番号の次を自動で付ける（`docs/app-store-submission.md` の「CI から上げる」）。リポジトリの値は上げなくてよいが、上がった番号は、リリースの PR で反映しておく（手元で上げるときの基準になる）。

## リリースの流れ

1. 上の表で、次の版を決める。
2. `package.json`・iOS の版と、ビルド番号を上げる PR を出して、マージする。
3. 提出手順（`docs/app-store-submission.md`）に進む。
4. ストアに出したら、`git tag v<版>`（例 `v1.1.0`）を、審査に出したコミットに付けて push する。

### 1.0 のタグ
1.0 は、審査に出したコミットの `package.json` が 0.2.0 だったので、`v1.0.0` は付けず、`v1.0-build2`（注釈付き。ビルド番号 2 で提出）にしている。`v<版>` の方式は、1.1.0 以降に使う。

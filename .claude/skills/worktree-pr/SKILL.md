---
name: worktree-pr
description: 変更を PR にして、レビュー・マージ・片づけまで進める手順（別の作業ツリーを使う）。コードや docs を変えて PR を出すとき、「マージして」と言われたときに使う。
---

# 作業ツリー → PR → レビュー → マージ → 片づけ

別のセッションが元のフォルダで作業していることがある。**元のフォルダで、ブランチを切り替えない・`checkout -- .`・`stash -u`・`clean` をしない。** ユーザーの未コミットの変更（特に `ios/signing.xcconfig`。署名のチーム ID）を守る。

## 1. 作業ツリーを作る

```bash
git fetch -q && git worktree add ../michishirube-<名前> -b <feat|fix|docs>/<名前> origin/main
cd ../michishirube-<名前> && ln -s ../michishirube/node_modules node_modules
```

- `node_modules` のシンボリックリンクは、`.gitignore` の `node_modules` に入るので、コミットされない。
- `cap sync` を作業ツリーで走らせると、`ios/App/CapApp-SPM/Package.swift` と `android/capacitor.settings.gradle` のパスが書き換わる。**コミットしない**（`git checkout <ファイル>` で戻す）。

## 2. 変更・確認

- `npx vitest run`（全テスト）、`npx tsc --noEmit -p .` と `npx tsc --noEmit -p worker`（型）。`pnpm typecheck` でも同じ。
- 画面を変えたら、実際の画面を確認する（スキル `verify-on-device`）。
- バグを直したら、再発を防ぐテストを足す。

## 3. PR

```bash
git add <ファイル> && git commit -m "<日本語の件名>"
git push -q -u origin <ブランチ>
gh pr create --title "<件名>" --body "<何をするか／影響／確認>"
```

- 説明の最後に、システムから指定された「Generated with Claude Code」の行を付ける（コミットメッセージの Co-Authored-By も同様）。
- 変更の大きさに合わせて、書く（小さい変更は短く）。

## 4. レビュー

- スキル `code-review` を、PR 番号を渡して実行し、`ReportFindings` で報告する。
- 指摘を直して push したら、**直後に** `ReportFindings` を、各指摘に `outcome`（`fixed`・`skipped`・`no_change_needed`）を付けて再報告する。
- 指摘が無いなら、空の配列で報告する。

## 5. ユーザーへの報告 → 「マージして」を待つ

- 何を変えたか、影響、確認したこと（**確認できなかったことも、正直に**）、ユーザーがやること（実機で見る、など）を、短く報告する。
- **「マージして」と言われるまで、マージしない。** 「実機で確認するので、マージして」のように、確認のためのマージの依頼もある。

## 6. マージ → 片づけ

```bash
gh pr merge <番号> --merge --delete-branch
git worktree remove --force ../michishirube-<名前>
git branch -D <ブランチ>
git push -q origin --delete <ブランチ>   # リモートが残っていたら
git fetch -q --prune
```

- マージ後に、CI とデプロイ（Pages・Worker）が成功したかを `gh run list` で見る。サーバーを変えたなら、本番の `https://latte.makimura.me/api/...` で、実際に試す。
- 同じ PR 番号を、別のセッションがマージ済みのことがある（`gh pr view N --json state`）。

## 注意

- `references/` はコミットしない。秘密の値・メール・チーム ID を、コミットしない。
- PR のベースは `main`。他の PR に依存するなら、先に、その PR をマージしてもらう。

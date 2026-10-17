#!/bin/sh
# Xcode で実行（ビルド）するたびに、画面（Web 側）を作り直してアプリに入れる。
# これで「main を pull して Xcode で実行するだけ」で、アプリが最新になる。
# 手で pnpm app:build を回す必要はない。
# 飛ばしたいとき（画面を変えていないとき）は、Xcode のスキームの環境変数に SKIP_WEB_BUILD=1 を入れる
set -eu

if [ "${SKIP_WEB_BUILD:-}" = "1" ]; then
  echo "SKIP_WEB_BUILD=1 なので、画面のビルドを飛ばす"
  exit 0
fi

cd "${SRCROOT}/../.."

# Xcode から呼ばれると PATH が最小なので、いつものシェルの PATH を借りる（nvm・nodebrew・pnpm など）
USER_PATH="$("${SHELL:-/bin/zsh}" -ilc 'printf "%s" "$PATH"' 2>/dev/null | tail -n 1 || true)"
if [ -n "$USER_PATH" ]; then
  PATH="$USER_PATH:$PATH"
  export PATH
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm が見つからない。ターミナルで pnpm が使える状態にしてから、もう一度実行してください" >&2
  exit 1
fi

pnpm install --frozen-lockfile
CAPACITOR=1 pnpm exec vite build
# 画面（dist）を ios/App/App/public に写す。プラグインを足したときだけ pnpm app:build（cap sync）が要る
pnpm exec cap copy ios

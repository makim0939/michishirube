import { t } from '../i18n'
import { en } from '../i18n/en'
import { ja } from '../i18n/ja'

/**
 * ラテアートでうまくいかなかったときの、よくある原因。記録のときにワンタップで選べるようにする（書かなくて済むように）。
 * 記録には文字列のまま保存して集計するので、名前を変えると過去の記録と別の原因になる（変えずに足す）。
 * 言語ごとに別の言葉で保存する（日本語で付けた原因は、英語に切り替えても日本語のまま残る）
 */
export const LATTE_CAUSES: readonly string[] = t.causes.list.map((c) => c.cause)

/**
 * 原因ごとの「次の一手」の候補。記録のときに押すだけで次の一手に入る（書かなくて済むように）。
 * 一般的な直し方なので、自分の言葉に書き換えてもよい。
 * 原因の並びは、どの言語でも同じ。別の言語で付けた原因にも、いまの言語の直し方を出す
 */
export function causeTip(cause: string): string | undefined {
  const i = [ja, en].map((m) => m.causes.list.findIndex((c) => c.cause === cause)).find((i) => i >= 0)
  return i === undefined ? undefined : t.causes.list[i]?.tip
}

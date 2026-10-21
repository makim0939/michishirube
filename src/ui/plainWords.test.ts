import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 画面に出る文言（コメント以外の行）を、画面と、画面に出るエラーを作る場所（ui・data・domain）から集める */
function visibleLines(dir: string): { file: string; no: number; line: string }[] {
  const base = new URL(`../${dir}/`, import.meta.url)
  return readdirSync(base)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .flatMap((f) =>
      readFileSync(new URL(f, base), 'utf8')
        .split('\n')
        .map((line, i) => ({ file: `${dir}/${f}`, no: i + 1, line }))
        // コメント行（// ・ * ・ /* ・ {/* ）は、画面に出ない
        .filter(({ line }) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
        // 日本語の文字を含む行だけ（コードの識別子や型名は見ない）
        .filter(({ line }) => /[぀-ヿ一-鿿]/.test(line))
        // 行の後ろのコメントは、画面に出ない（引用符を含む「// …」は、文字列の中かもしれないので消さない）
        .map(({ file, no, line }) => ({ file, no, line: line.replace(/\s\/\/\s[^'"`]*$/, '').replace(/\{\/\*.*?\*\/\}/g, '') })),
    )
}

describe('画面の言葉（一般の人に分かる言い方）', () => {
  // 作り手の言葉は、画面に出さない。使ってよい言い方を、右に書く
  const words: [RegExp, string][] = [
    [/ZIP/, 'ファイル'],
    [/README/, '（案内しない）'],
    [/JSON/, 'ファイル'],
    [/サーバー/, '（言わない。「つながりません」など）'],
    [/連携/, 'つなぐ'],
    [/限定公開/, 'リンクを知っている人だけ'],
  ]
  const lines = [...visibleLines('ui'), ...visibleLines('data'), ...visibleLines('domain')]

  for (const [word, instead] of words) {
    it(`「${word.source}」は画面に出さない（${instead}）`, () => {
      const found = lines.filter(({ line }) => word.test(line)).map(({ file, no, line }) => `${file}:${no} ${line.trim()}`)
      expect(found).toEqual([])
    })
  }
})

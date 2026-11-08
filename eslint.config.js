import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

// 目的は、フックの呼び方の間違い（早い return より後ろのフック・条件つきのフック）を、型検査・単体テストの前に落とすこと。
// 見るのは react-hooks の 2 つのルールだけに絞る（一般の書き方の好みは、ここでは取り締まらない）
export default [
  // 上の理由で off にしたルールを指す既存の eslint-disable コメントが、「使われていない」と警告されないようにする
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'android/**', 'ios/**', 'worker/**', 'public/**', 'scripts/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // フックの数が、描画のたびに変わると、画面が落ちる（#182 の記録画面）
      'react-hooks/rules-of-hooks': 'error',
      // exhaustive-deps は off：このコードは、「動画が変わったときだけ」など、依存を意図して絞った effect が多く（10 件の警告は、いずれも意図した省略）、
      // 警告を常に出すと、本物の警告が埋もれる。フックの数の間違いと違って、画面が落ちるものではない
      'react-hooks/exhaustive-deps': 'off',
    },
  },
]

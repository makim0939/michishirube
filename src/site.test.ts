import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('アプリのトップページ（サーバーと同じドメインで配る）', () => {
  it('プライバシーポリシーは、アプリの中のものと同じ（コピーがずれないように）', () => {
    expect(read('../worker/site/privacy.html')).toBe(read('../public/privacy.html'))
  })

  it('トップページに、アプリ名とプライバシーポリシーへのリンクがある（Google の審査で見られる）', () => {
    const html = read('../worker/site/index.html')
    expect(html).toContain('<h1>ラテ帳</h1>')
    expect(html).toContain('href="/privacy"')
  })
})

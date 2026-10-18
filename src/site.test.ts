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

  it('プライバシーポリシー（日本語・英語）に、Google の審査で見られることが書いてある', () => {
    for (const path of ['../worker/site/privacy.html', '../worker/site/privacy-en.html']) {
      const html = read(path)
      expect(html).toContain('https://www.googleapis.com/auth/youtube.upload')
      expect(html).toContain('https://developers.google.com/terms/api-services-user-data-policy')
      expect(html).toContain('https://myaccount.google.com/permissions')
      // YouTube API サービスの規約が、ポリシーに求めること
      expect(html).toContain('https://www.youtube.com/t/terms')
      expect(html).toContain('https://policies.google.com/privacy')
      expect(html).toContain('https://security.google.com/settings/security/permissions')
    }
    expect(read('../worker/site/privacy-en.html')).toContain('Limited Use')
  })

  // 英語の説明（Google の審査で、ホームページに求められる）は、トップページには置かず、
  // 英語版のページ（/en）に分ける方針。/en ができたら、そのページに英文と /privacy-en へのリンクがあることを、ここで確かめる
})

describe('トップページの紹介（アプリの画面）', () => {
  it('ページが読み込む画像と、アプリへのリンクがそろっている', () => {
    const html = read('../worker/site/index.html')
    const images = [...html.matchAll(/src="\/(img\/[\w-]+\.webp)"/g)].map((m) => m[1])
    expect(images.length).toBeGreaterThan(0)
    for (const path of images) expect(() => read(`../worker/site/${path}`)).not.toThrow()
    expect(html).toContain('href="https://makim0939.github.io/michishirube/"')
  })
})

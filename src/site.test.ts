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

  // 英語の説明は、トップページではなく、英語版のページ（/en）に置く
  it('英語版のページ（/en）に、英語の説明と、英語のプライバシーポリシーへのリンクがある', () => {
    const html = read('../worker/site/en.html')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('YouTube upload permission')
    expect(html).toContain('href="/privacy-en"')
  })

  it('トップページから、英語版のページ（/en）が見つかる', () => {
    expect(read('../worker/site/index.html')).toContain('hreflang="en" href="https://latte.makimura.me/en"')
  })
})

describe('シェア用の画像（og.png）の文言', () => {
  // キャッチを直したのに、画像が古いままになったことがあった。作り方のスクリプトと og:image:alt が、サイトのキャッチと同じことを確かめる
  const text = (html: string) => html.replace(/<[^>]*>/g, '')
  it('キャッチと補足が、作り方のスクリプトと og:image:alt にそろっている', () => {
    const html = read('../worker/site/index.html')
    const catchCopy = text(html.match(/<h2 class="catch">([\s\S]*?)<\/h2>/)![1]).replace(/\s/g, '')
    const subCopy = text(html.match(/<p class="sub">([\s\S]*?)<\/p>/)![1]).replace(/\s/g, '')
    expect(html).toContain(`キャッチコピー「${catchCopy}」`)
    const script = read('../.claude/skills/app-screenshots/make-og.py')
    // スクリプトでは、行ごと・大きさごとに分けて書いてあるので、引用符と区切りを除いて、つなげて比べる
    const flat = [...script.matchAll(/\('([^']*)', \w+, \w+\)/g)].map((m) => m[1]).join('')
    expect(flat).toContain(catchCopy)
    expect(flat).toContain(subCopy.replace(/<br\s*\/?>/g, ''))
  })
})

describe('トップページの紹介（アプリの画面）', () => {
  it('ページが読み込む画像と、アプリへのリンクがそろっている', () => {
    const html = read('../worker/site/index.html')
    const images = [...html.matchAll(/(?:src|poster)="\/(img\/[\w-]+\.(?:webp|mp4))"/g)].map((m) => m[1])
    expect(images.length).toBeGreaterThan(0)
    for (const path of images) expect(() => read(`../worker/site/${path}`)).not.toThrow()
    expect(html).toContain('href="https://makim0939.github.io/michishirube/"')
  })
})

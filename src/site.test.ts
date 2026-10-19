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

  it('プライバシーポリシーの末尾は、Web 版ではなく、ラテ帳のホームページに戻る', () => {
    const html = read('../worker/site/privacy.html')
    expect(html).toContain('<a href="https://latte.makimura.me/">ラテ帳のホームページ</a>')
    expect(html).not.toContain('ラテ帳を開く')
  })

  it('トップページのフッターの「お問い合わせ」は、makimura.me のお問い合わせページへ', () => {
    expect(read('../worker/site/index.html')).toContain('<a href="https://www.makimura.me/contact">お問い合わせ</a>')
  })

  it('プライバシーポリシー（日本語・英語）の問い合わせ先は、makimura.me のお問い合わせページ', () => {
    for (const path of ['../worker/site/privacy.html', '../worker/site/privacy-en.html']) {
      const html = read(path)
      expect(html).toContain('href="https://www.makimura.me/contact"')
      expect(html).not.toContain('michishirube/issues')
    }
  })

  it('トップページから、英語版のページ（/en）が見つかる', () => {
    expect(read('../worker/site/index.html')).toContain('hreflang="en" href="https://latte.makimura.me/en"')
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

import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('アプリのトップページ（サーバーと同じドメインで配る）', () => {
  it('プライバシーポリシー（日本語・英語）は、アプリの中のものと同じ（コピーがずれないように）', () => {
    expect(read('../worker/site/privacy.html')).toBe(read('../public/privacy.html'))
    expect(read('../worker/site/privacy-en.html')).toBe(read('../public/privacy-en.html'))
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

  // Web 版（GitHub Pages のサブパス）でも開くので、サイトの中を / で始まるリンクにしない
  it('英語のプライバシーポリシーのリンクは、Web 版の中で開いても、ラテ帳のサイトに届く', () => {
    const html = read('../worker/site/privacy-en.html')
    expect(html).not.toMatch(/href="\//)
    expect(html).toContain('<a href="https://latte.makimura.me/en">Latte-chō home page</a>')
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

  // ページを足したのに、サイトマップに載せ忘れないように
  it('サイトマップに、サイトのページがすべて載っていて、robots.txt から見つかる', () => {
    const sitemap = read('../worker/site/sitemap.xml')
    const locs = [...sitemap.matchAll(/<loc>https:\/\/latte\.makimura\.me(\/[\w-]*)<\/loc>/g)].map((m) => m[1])
    // 配るときの URL にそろえる（index.html は /、ほかは拡張子なし）。/index と書いたら、ずれて落ちる
    const pages = readdirSync(new URL('../worker/site/', import.meta.url))
      .filter((name) => name.endsWith('.html'))
      .map((name) => (name === 'index.html' ? '/' : `/${name.replace(/\.html$/, '')}`))
    expect(locs.sort()).toEqual(pages.sort())
    expect(read('../worker/site/robots.txt')).toContain('Sitemap: https://latte.makimura.me/sitemap.xml')
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

  it('description・og:title・og:description が、キャッチと補足にそろっている（title は、検索の言葉）', () => {
    const html = read('../worker/site/index.html')
    const catchCopy = text(html.match(/<h2 class="catch">([\s\S]*?)<\/h2>/)![1]).replace(/\s/g, '')
    const subCopy = text(html.match(/<p class="sub">([\s\S]*?)<\/p>/)![1]).replace(/\s/g, '')
    const meta = (attr: string, name: string) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))![1]
    const title = html.match(/<title>([^<]*)<\/title>/)![1]
    // <title>（検索結果・タブ）は、検索で見つかる言葉（練習・アプリ）を入れる。og:title（シェアのカード）は、キャッチにそろえる
    // （末尾の「。」は、タイトルでは付けない）
    expect(title).toBe('ラテ帳｜ラテアート練習の記録アプリ')
    expect(meta('property', 'og:title')).toBe(`ラテ帳｜${catchCopy.replace(/。$/, '')}`)
    expect(meta('name', 'description')).toBe(catchCopy + subCopy)
    expect(meta('property', 'og:description')).toBe(subCopy)
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

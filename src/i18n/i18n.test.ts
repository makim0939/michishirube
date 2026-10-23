import { afterEach, describe, expect, it, vi } from 'vitest'
import latteArt from '../roadmaps/latte-art.json'
import latteArtEn from '../roadmaps/latte-art.en.json'
import { parseTemplate } from '../domain/template'
import { patternFor } from '../ui/world'
import { pickLang } from '.'

describe('言語の決め方', () => {
  it('アプリが渡した言語を、いちばん先に使う（iPhone の設定でアプリごとに選んだ言語）', () => {
    expect(pickLang('en', 'ja', 'ja-JP')).toBe('en')
    expect(pickLang('ja', 'en', 'en-US')).toBe('ja')
  })

  it('Web 版では、設定で選んだ言語を、ブラウザの言語より先に使う', () => {
    expect(pickLang(undefined, 'en', 'ja-JP')).toBe('en')
    expect(pickLang(undefined, 'ja', 'en-US')).toBe('ja')
  })

  it('選んでいなければブラウザの言語に合わせ、日本語以外は英語にする', () => {
    expect(pickLang(undefined, 'auto', 'ja-JP')).toBe('ja')
    expect(pickLang(undefined, 'auto', 'en-GB')).toBe('en')
    expect(pickLang(undefined, 'auto', 'fr-FR')).toBe('en')
  })

  it('何も分からなければ日本語', () => {
    expect(pickLang(undefined, 'auto', undefined)).toBe('ja')
  })
})

describe('英語の同梱の型', () => {
  const ja = parseTemplate(latteArt)
  const en = parseTemplate(latteArtEn)

  it('日本語と同じ型が、同じ並びと前提で入っている', () => {
    expect(en.skills.map((s) => [s.key, s.prereqs])).toEqual(ja.skills.map((s) => [s.key, s.prereqs]))
  })

  it('どの型にも、日本語の型と同じ見本の絵が付く', () => {
    for (const [i, s] of en.skills.entries()) {
      expect(patternFor(s.name), s.name).toBeDefined()
      expect(patternFor(s.name), s.name).toBe(patternFor(ja.skills[i].name))
    }
  })
})

describe('英語で使っているとき', () => {
  afterEach(() => {
    ;(globalThis as { __APP_LANGUAGE__?: string }).__APP_LANGUAGE__ = 'ja'
    vi.resetModules()
  })

  // 文言は読み込まれたときに言語を決めるので、言語を変えてから読み込み直す
  async function loadInEnglish() {
    ;(globalThis as { __APP_LANGUAGE__?: string }).__APP_LANGUAGE__ = 'en'
    vi.resetModules()
    return {
      repo: await import('../data/repo'),
      format: await import('../domain/format'),
      videoText: await import('../data/videoText'),
    }
  }

  it('最初に入る型は、英語の型', async () => {
    const { repo } = await loadInEnglish()
    expect(repo.BUNDLED_TEMPLATES.map((t) => t.domain)).toEqual(['Latte art'])
  })

  it('日付は英語の書き方になる', async () => {
    const { format } = await loadInEnglish()
    expect(format.formatDate(new Date(2026, 9, 10, 9, 5).getTime())).toBe('Oct 10, 2026')
    expect(format.formatDateTime(new Date(2026, 9, 10, 9, 5).getTime())).toBe('Oct 10, 2026 9:05 AM')
  })

  it('YouTube のタイトルの標準は英語で、空の項目の区切りはまとまる', async () => {
    const { videoText } = await loadInEnglish()
    const { title } = videoText.buildVideoText(
      { title: videoText.DEFAULT_TITLE, description: videoText.DEFAULT_DESCRIPTION },
      { 日時: 'Oct 10, 2026 9:05 AM' },
    )
    expect(title).toBe('Latte art | Oct 10, 2026 9:05 AM')
  })
})

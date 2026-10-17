import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, describeEnvironment, loadDraft, osOf, saveDraft } from './feedback'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

describe('端末の情報', () => {
  it('OS の名前と版を読み取る', () => {
    expect(osOf(IPHONE)).toBe('iOS 18.2')
    expect(osOf(IPAD)).toBe('iPadOS 17.5')
    expect(osOf(PIXEL)).toBe('Android 15')
    expect(osOf(MAC_SAFARI)).toBe('macOS')
  })

  it('アプリでは OS だけ、Web 版ではブラウザと開き方まで添える', () => {
    expect(describeEnvironment(IPHONE, 'ios', false)).toBe('iOS 18.2')
    expect(describeEnvironment(PIXEL, 'android', false)).toBe('Android 15')
    expect(describeEnvironment(MAC_SAFARI, 'web', false)).toBe('macOS・Safari・ブラウザ')
    expect(describeEnvironment(IPHONE, 'web', true)).toBe('iOS 18.2・ホーム画面から')
  })
})

describe('書きかけの内容', () => {
  // テストは Node で動くので、localStorage の代わりを置く
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  it('残した内容を、次に開いたときに戻す', () => {
    saveDraft({ kind: 'bug', message: '録画が止まる', contact: '' })
    expect(loadDraft()).toEqual({ kind: 'bug', message: '録画が止まる', contact: '' })
  })

  it('空にしたら残さない。消したあとも残さない', () => {
    saveDraft({ kind: 'idea', message: 'あ', contact: '' })
    saveDraft({ kind: 'idea', message: '  ', contact: '' })
    expect(loadDraft()).toBeNull()
    saveDraft({ kind: 'idea', message: 'あ', contact: '' })
    clearDraft()
    expect(loadDraft()).toBeNull()
  })

  it('壊れた内容は無いものとして扱う', () => {
    localStorage.setItem('michishirube:feedback-draft', '{broken')
    expect(loadDraft()).toBeNull()
    localStorage.setItem('michishirube:feedback-draft', JSON.stringify({ kind: 'x', message: 'あ' }))
    expect(loadDraft()?.kind).toBe('idea')
  })
})

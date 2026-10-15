import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireUrl, clearImageCaches, recallContent, rememberContent, urlFor } from './imageCache'

const blob = (s: string) => new Blob([s])
const SEC = 1000

describe('写真の置き場（メモリにゴミが溜まらないこと）', () => {
  let revoked: string[]
  let seq: number

  beforeEach(() => {
    vi.useFakeTimers()
    revoked = []
    seq = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++seq}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void revoked.push(u))
  })

  afterEach(() => {
    clearImageCaches()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('同じ key なら、同じ URL を返す（作り直さない）', () => {
    const a = urlFor('a', blob('a'))
    expect(urlFor('a', blob('a'))).toBe(a)
    expect(seq).toBe(1)
  })

  it('使われないまま30分たったら、URL も中身も手放す（設定を触っている間などは、残す）', () => {
    const url = urlFor('a', blob('a'))
    rememberContent('c', blob('c'))
    vi.advanceTimersByTime(10 * 60 * SEC)
    expect(revoked).toEqual([])
    expect(recallContent('c')).toBeDefined()
    vi.advanceTimersByTime(40 * 60 * SEC)
    expect(revoked).toContain(url)
    expect(recallContent('c')).toBeUndefined()
  })

  it('表示中（使っている）の URL は、30分たっても手放さず、閉じたあとに手放す', () => {
    const url = urlFor('a', blob('a'))
    const release = acquireUrl('a')!
    vi.advanceTimersByTime(60 * 60 * SEC)
    expect(revoked).not.toContain(url)
    release()
    vi.advanceTimersByTime(40 * 60 * SEC)
    expect(revoked).toContain(url)
  })

  it('上限を超えたら、使われていない古いものから手放す。直前に使われたものは残す', () => {
    const urls = Array.from({ length: 70 }, (_, i) => urlFor(`k${i}`, blob(String(i))))
    vi.advanceTimersByTime(40 * SEC)
    // 古い 10 本が手放される（上限 60）
    expect(revoked).toEqual(urls.slice(0, 10))
    // 直前に使い直したものは、上限を超えていても手放さない
    const fresh = urlFor('k20', blob('20'))
    for (let i = 70; i < 80; i++) urlFor(`k${i}`, blob(String(i)))
    vi.advanceTimersByTime(1 * SEC)
    expect(revoked).not.toContain(fresh)
  })

  it('すべて削除では、使っていないものをすぐ手放す', () => {
    const a = urlFor('a', blob('a'))
    const b = urlFor('b', blob('b'))
    acquireUrl('b')
    rememberContent('c', blob('c'))
    clearImageCaches()
    expect(revoked).toEqual([a])
    expect(revoked).not.toContain(b)
    expect(recallContent('c')).toBeUndefined()
  })
})

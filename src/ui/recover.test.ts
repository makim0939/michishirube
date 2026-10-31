import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isChunkLoadError, reloadOnce } from './recover'

describe('部品の読み込み失敗の判定', () => {
  it('動的 import の失敗（Safari・Chrome・webpack 形式）を見分ける', () => {
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading chunk 12 failed.'))).toBe(true)
  })
  it('ふつうの例外は、部品の失敗として扱わない', () => {
    expect(isChunkLoadError(new TypeError("undefined is not an object (evaluating 'x.y')"))).toBe(false)
  })
})

describe('読み込み直し', () => {
  const reload = vi.fn()
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('window', {
      location: { reload },
      sessionStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
      },
    })
    reload.mockClear()
  })
  it('直近に読み込み直していたら、繰り返さない', () => {
    expect(reloadOnce(100_000)).toBe(true)
    expect(reloadOnce(110_000)).toBe(false)
    expect(reloadOnce(140_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
  it('覚えておけないときは、止まらなくなるのを避けて読み込み直さない', () => {
    vi.stubGlobal('window', { location: { reload }, sessionStorage: { getItem: () => null, setItem: () => {} } })
    expect(reloadOnce(100_000)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})

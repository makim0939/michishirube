import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { BUNDLED_BGM, bgmBlob, bgmExtension, bgmTitle, formatSeconds } from './bgm'

const file = (name: string): { kind: 'file'; file: File } => ({ kind: 'file', file: new File(['x'], name) })

describe('BGM の名前と種類', () => {
  it('ファイル名から、拡張子を外した名前と、小文字の拡張子を取る', () => {
    expect(bgmTitle(file('Morning Light.MP3'))).toBe('Morning Light')
    expect(bgmExtension(file('Morning Light.MP3'))).toBe('mp3')
  })

  it('拡張子が無ければ m4a として扱う', () => {
    expect(bgmExtension(file('song'))).toBe('m4a')
  })

  it('同梱の曲は、置き場所の拡張子を使う', () => {
    expect(bgmExtension({ kind: 'bundled', track: { id: 'a', title: 'A', path: 'bgm/a.m4a', seconds: 10 } })).toBe('m4a')
  })
})

describe('同梱の曲を読む', () => {
  const track = { kind: 'bundled' as const, track: { id: 'a', title: 'A', path: 'bgm/a.m4a', seconds: 10 } }
  afterEach(() => vi.unstubAllGlobals())

  it('iPhone のアプリは、成功でも status が 0（HTTP でない応答）になるので、中身があれば読めたことにする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 0, ok: false, blob: async () => new Blob(['x']) }))
    expect((await bgmBlob(track)).size).toBe(1)
  })

  it('404 などは、読めなかったことにする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false, blob: async () => new Blob(['x']) }))
    await expect(bgmBlob(track)).rejects.toThrow('404')
  })

  it('中身が空なら、読めなかったことにする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, blob: async () => new Blob([]) }))
    await expect(bgmBlob(track)).rejects.toThrow('空')
  })
})

describe('同梱の曲', () => {
  it('id が重ならず、public/bgm/ にファイルがある', () => {
    expect(new Set(BUNDLED_BGM.map((x) => x.id)).size).toBe(BUNDLED_BGM.length)
    for (const x of BUNDLED_BGM) expect(existsSync(`public/${x.path}`), x.path).toBe(true)
  })

  it('一覧に出す長さは、分:秒（秒は 2 桁）', () => {
    expect(formatSeconds(25.7)).toBe('0:26')
    expect(formatSeconds(56.8)).toBe('0:57')
    expect(formatSeconds(125)).toBe('2:05')
  })
})

import { describe, expect, it } from 'vitest'
import { bgmExtension, bgmTitle } from './bgm'

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
    expect(bgmExtension({ kind: 'bundled', track: { id: 'a', title: 'A', path: 'bgm/a.m4a' } })).toBe('m4a')
  })
})

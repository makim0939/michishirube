import { describe, expect, it } from 'vitest'
import { showYoutubeSection } from './youtubeSection'

describe('設定「動画」の YouTube の欄', () => {
  it('保存先が YouTube なら、つないでいなくても出す（ログインやつなぐ操作のため）', () => {
    expect(showYoutubeSection('youtube', false)).toBe(true)
  })

  it('保存先が端末でも、つないでいるなら出す（つなぐのをやめられるように）', () => {
    expect(showYoutubeSection('device', true)).toBe(true)
  })

  it('保存先が端末で、つないでもいないなら、出さない', () => {
    expect(showYoutubeSection('device', false)).toBe(false)
  })
})

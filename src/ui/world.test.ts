import { describe, expect, it } from 'vitest'
import { patternFor } from './world'

describe('patternFor', () => {
  it('同梱の型の名前から、それぞれの見本を選ぶ', () => {
    expect(patternFor('ハート')).toBe('heart')
    expect(patternFor('チューリップ')).toBe('tulip2')
    expect(patternFor('ロゼッタ（リーフ）')).toBe('rosetta')
    expect(patternFor('レイヤーハート')).toBe('layerheart')
    expect(patternFor('ウィングチューリップ')).toBe('wing')
    expect(patternFor('スワン')).toBe('swan')
  })

  it('ウィングハートは、ウィングチューリップの絵ではなく、ウィングハートの絵にする（ウイングの表記でも）', () => {
    expect(patternFor('ウィングハート')).toBe('wingheart')
    expect(patternFor('ウイングハート')).toBe('wingheart')
  })

  it('見本の無い名前は、絵なし', () => {
    expect(patternFor('たこやきまる')).toBeUndefined()
  })
})

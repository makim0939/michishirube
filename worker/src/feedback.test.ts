import { describe, expect, it } from 'vitest'
import { parseFeedback } from './feedback'
import { BadRequest } from './sync'

const valid = { kind: 'idea', message: '  動画を並べて見たい  ', contact: '', platform: 'ios', appVersion: '0.2.0', env: 'iOS 18' }

describe('ご意見・ご要望の検査', () => {
  it('前後の空白を取って受け取る。返信先と端末の情報は省ける', () => {
    expect(parseFeedback(valid).message).toBe('動画を並べて見たい')
    const { contact: _c, env: _e, ...minimal } = valid
    expect(parseFeedback(minimal)).toMatchObject({ contact: '', env: '' })
  })

  it('本文が空・長すぎる・種類や端末が知らないものは断る', () => {
    expect(() => parseFeedback({ ...valid, message: '   ' })).toThrow(BadRequest)
    expect(() => parseFeedback({ ...valid, message: 'あ'.repeat(2001) })).toThrow(BadRequest)
    expect(() => parseFeedback({ ...valid, kind: 'spam' })).toThrow(BadRequest)
    expect(() => parseFeedback({ ...valid, platform: 'windows' })).toThrow(BadRequest)
    expect(() => parseFeedback({ ...valid, contact: 1 })).toThrow(BadRequest)
  })
})

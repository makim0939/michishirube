import { describe, expect, it, vi } from 'vitest'
import { buildFeedbackMail, notifyFeedback, parseFeedback } from './feedback'
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

describe('要望の通知メール', () => {
  const input = parseFeedback(valid)
  const now = Date.UTC(2026, 9, 17, 3, 5)

  it('本文と端末の情報を載せ、件名には本文を入れない', () => {
    const mail = buildFeedbackMail(input, 'abc', 'owner@example.com', 'noreply@example.com', now)
    expect(mail.subject).toBe('[ラテ帳] ご要望が届きました')
    expect(mail.text).toContain('動画を並べて見たい')
    expect(mail.text).toContain('受信：2026-10-17 12:05（日本時間）')
    expect(mail.text).toContain('端末：ios　版：0.2.0　iOS 18')
    expect(mail.text).toContain('返信先：（書かれていません）')
    expect(mail).not.toHaveProperty('replyTo')
  })

  it('返信先がメールアドレスのときだけ、メールの返信先にする', () => {
    expect(buildFeedbackMail({ ...input, contact: 'user@example.com' }, 'abc', 'a@example.com', 'b@example.com')).toMatchObject({ replyTo: 'user@example.com' })
    expect(buildFeedbackMail({ ...input, contact: '@latte_user' }, 'abc', 'a@example.com', 'b@example.com')).not.toHaveProperty('replyTo')
    expect(buildFeedbackMail({ ...input, contact: 'x@example.com\nBcc: y@example.com' }, 'abc', 'a@example.com', 'b@example.com')).not.toHaveProperty('replyTo')
  })

  it('宛先・送り元・送信の設定が揃っていなければ、送らない', async () => {
    const send = vi.fn()
    await notifyFeedback({ MAIL: { send } as unknown as SendEmail, FEEDBACK_NOTIFY_FROM: 'noreply@example.com' }, input, 'abc')
    await notifyFeedback({ FEEDBACK_NOTIFY_TO: 'owner@example.com', FEEDBACK_NOTIFY_FROM: 'noreply@example.com' }, input, 'abc')
    expect(send).not.toHaveBeenCalled()
  })

  it('送れなくても例外を投げない（要望は保存済みなので、利用者の送信は成功のままにする）', async () => {
    const send = vi.fn().mockRejectedValue(new Error('not verified'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(notifyFeedback({ MAIL: { send } as unknown as SendEmail, FEEDBACK_NOTIFY_TO: 'owner@example.com', FEEDBACK_NOTIFY_FROM: 'noreply@example.com' }, input, 'abc')).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})

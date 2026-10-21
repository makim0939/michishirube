import { describe, expect, it } from 'vitest'
import { SITE_URL } from '../platform'
import type { Media } from '../domain/types'
import { SyncError } from './sync'
import { QuotaExceeded, uploadStopReason, uploadVideo, videoMeta, YoutubeApiError } from './youtube'

describe('YouTube に付ける説明', () => {
  it('説明の最後に、アプリの紹介ページのリンクを付ける（説明欄から来てもらう）', async () => {
    const media = { id: 'm1', recordId: 'none', skillId: 'none', type: 'video/mp4', createdAt: 1 } as Media
    const { description } = await videoMeta(media)
    expect(description.trimEnd().endsWith(SITE_URL)).toBe(true)
    expect(description).toContain('ラテ帳で記録')
  })
})

describe('アップが止まった理由（画面に出す文）', () => {
  it('YouTube の英語のエラー文は出さず、番号から日本語の文にする', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: 'The request cannot be completed because you have exceeded your quota.' } }), {
        status: 403,
      })) as typeof fetch
    const error = await uploadVideo(new Blob(['x'], { type: 'video/mp4' }), { title: 't', description: 'd' }, 'token', fetchImpl).catch((e) => e)
    expect(error).toBeInstanceOf(YoutubeApiError)
    expect(error.message).toContain('YouTube に断られました')
    expect(error.message).not.toMatch(/[A-Za-z]{4,} [A-Za-z]{4,}/)
  })

  it('YouTube 側のエラー（5xx）は、電波のせいにせず、YouTube 側と言う', () => {
    const reason = uploadStopReason(new YoutubeApiError(503), true)
    expect(reason).toContain('YouTube 側でエラーが起きています')
    expect(reason).not.toContain('電波')
  })

  it('端末がオンラインのときの通信の失敗は、電波と決めつけない', () => {
    const reason = uploadStopReason(new TypeError('Load failed'), true)
    expect(reason).toContain('YouTube に送れませんでした')
    expect(reason).not.toContain('電波')
  })

  it('端末がオフラインと分かるときだけ、通信できないと言う', () => {
    expect(uploadStopReason(new TypeError('Load failed'), false)).toContain('通信できません')
  })

  it('つながりの確認が番号つきで失敗したときは、その番号を添える', () => {
    expect(uploadStopReason(new SyncError('x', 502), true)).toContain('502')
  })

  it('1日の上限は、上限に達したと言う', () => {
    expect(uploadStopReason(new QuotaExceeded('今日アップロードできる上限に達しました'), true)).toContain('上限')
  })
})

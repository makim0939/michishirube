import { describe, expect, it } from 'vitest'
import { parseHash } from './router'

describe('設定の画面', () => {
  it('項目の画面を開く', () => {
    expect(parseHash('#/settings')).toEqual({ name: 'settings' })
    expect(parseHash('#/settings/storage')).toEqual({ name: 'settings', section: 'storage' })
    expect(parseHash('#/settings/roadmaps')).toEqual({ name: 'settings', section: 'roadmaps' })
  })

  it('ご意見・ご要望の画面を開く', () => {
    expect(parseHash('#/settings/feedback')).toEqual({ name: 'settings', section: 'feedback' })
  })

  it('YouTube の連携から戻ったら、同期の画面で結果を受け取る', () => {
    expect(parseHash('#/settings/youtube-connected')).toEqual({
      name: 'settings',
      section: 'sync',
      notice: 'youtube-connected',
    })
    expect(parseHash('#/settings/youtube-failed')).toMatchObject({ section: 'sync', notice: 'youtube-failed' })
  })

  it('知らない項目は、設定の一覧にする', () => {
    expect(parseHash('#/settings/unknown')).toEqual({ name: 'settings' })
  })
})

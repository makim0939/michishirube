import { describe, expect, it } from 'vitest'
import { SITE_URL } from '../platform'
import type { Media } from '../domain/types'
import { videoMeta } from './youtube'

describe('YouTube に付ける説明', () => {
  it('説明の最後に、アプリの紹介ページのリンクを付ける（説明欄から来てもらう）', async () => {
    const media = { id: 'm1', recordId: 'none', skillId: 'none', type: 'video/mp4', createdAt: 1 } as Media
    const { description } = await videoMeta(media)
    expect(description.trimEnd().endsWith(SITE_URL)).toBe(true)
    expect(description).toContain('ラテ帳で記録')
  })
})

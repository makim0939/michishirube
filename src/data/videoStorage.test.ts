import { describe, expect, it } from 'vitest'
import { db } from './db'
import { getVideoStorage, setVideoStorage, uploadBacklog } from './videoStorage'

const video = (id: string, upload: 'pending' | 'uploading' | 'done' | 'failed') => ({
  id,
  recordId: `r-${id}`,
  skillId: 's',
  type: 'video/mp4',
  size: 1,
  createdAt: 1,
  updatedAt: 1,
  upload,
})

describe('ホームに出すアップの状況', () => {
  it('保存先が端末のあいだは、アップ待ちの動画があっても数えない', async () => {
    // 動画は保存先に関係なく pending で保存されるが、端末に置く設定では上げない
    await db.media.bulkAdd([video('a', 'pending'), video('b', 'failed')])
    expect(await getVideoStorage()).toBe('device')
    expect(await uploadBacklog()).toEqual({ waiting: 0, failed: 0 })
  })

  it('保存先が YouTube なら、待ちと失敗を分けて数える（上げ終えたものは数えない）', async () => {
    await setVideoStorage('youtube')
    await db.media.bulkAdd([video('a', 'pending'), video('b', 'uploading'), video('c', 'failed'), video('d', 'done')])
    expect(await uploadBacklog()).toEqual({ waiting: 2, failed: 1 })
  })

  it('選んでいなくても、YouTube に上げた動画がある端末は YouTube として数える', async () => {
    await db.media.bulkAdd([video('a', 'done'), video('b', 'pending')])
    expect(await uploadBacklog()).toEqual({ waiting: 1, failed: 0 })
  })
})

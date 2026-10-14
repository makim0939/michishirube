import { describe, expect, it } from 'vitest'
import { contentBlob, contentPath, hasContent } from './content'

describe('動画・写真の中身', () => {
  it('blob か、アプリのファイルのどちらかにあれば、端末にある', () => {
    expect(hasContent({ blob: new Blob(['x']) })).toBe(true)
    expect(hasContent({ file: 'media/a.mp4' })).toBe(true)
    expect(hasContent({})).toBe(false)
  })

  it('blob があればそれを返す', async () => {
    const blob = new Blob(['x'])
    expect(await contentBlob({ blob, type: 'image/jpeg' })).toBe(blob)
    expect(await contentBlob({ type: 'image/jpeg' })).toBeUndefined()
  })

  it('ファイルの名前は、中身を差し替えるたびに変わる', () => {
    const m = { id: 'm1', type: 'video/mp4', createdAt: 1 }
    expect(contentPath(m)).toBe('media/m1-1.mp4')
    expect(contentPath({ ...m, contentAt: 9 })).toBe('media/m1-9.mp4')
    expect(contentPath({ ...m, type: 'image/jpeg', contentAt: 9 })).toBe('media/m1-9.jpg')
  })
})

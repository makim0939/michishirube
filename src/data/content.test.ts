import { describe, expect, it } from 'vitest'
import { contentBlob, contentPath, hasContent, mayBeOnServer } from './content'

describe('動画・写真の中身', () => {
  it('blob か、アプリのファイルのどちらかにあれば、端末にある', () => {
    expect(hasContent({ blob: new Blob(['x']) })).toBe(true)
    expect(hasContent({ file: 'media/a.mp4' })).toBe(true)
    expect(hasContent({})).toBe(false)
  })

  it('写真は、サーバーに置いた印が端末の行に無くても、縮小した大きさならサーバーにありそうとみなす', () => {
    expect(mayBeOnServer({ type: 'image/jpeg', size: 58952, cloudPhoto: true })).toBe(true)
    expect(mayBeOnServer({ type: 'image/jpeg', size: 58952 })).toBe(true)
    // サーバーに置けるのは 2MB まで。それより大きい写真は、印が無ければ探さない
    expect(mayBeOnServer({ type: 'image/jpeg', size: 3 * 1024 * 1024 })).toBe(false)
    expect(mayBeOnServer({ type: 'image/jpeg', size: 3 * 1024 * 1024, cloudPhoto: true })).toBe(true)
    // 動画は、サーバーに置かない
    expect(mayBeOnServer({ type: 'video/mp4', size: 1, cloudPhoto: true })).toBe(false)
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

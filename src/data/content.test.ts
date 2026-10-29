import { describe, expect, it } from 'vitest'
import { contentBlob, contentPath, fileBackedVideo, hasContent, mayBeOnServer } from './content'

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

  describe('保存済みの動画を、メモリに読まずにファイルの URL のまま使うか', () => {
    const video = { type: 'video/mp4', file: 'media/a.mp4' }

    it('ファイルの URL に対応した端末（iPhone）で、ファイルにある動画なら、そのファイルの場所を返す', () => {
      expect(fileBackedVideo(video, true)).toBe('media/a.mp4')
    })

    it('対応していない端末（Android・Web）では、これまでどおりメモリに読む（返さない）', () => {
      expect(fileBackedVideo(video, false)).toBeUndefined()
    })

    it('すでにメモリにある動画（切り取った直後など）は、そちらを使う', () => {
      expect(fileBackedVideo({ ...video, blob: new Blob(['x']) }, true)).toBeUndefined()
    })

    it('写真は対象にしない', () => {
      expect(fileBackedVideo({ type: 'image/jpeg', file: 'media/a.jpg' }, true)).toBeUndefined()
    })

    it('ファイルが無い動画は返さない', () => {
      expect(fileBackedVideo({ type: 'video/mp4' }, true)).toBeUndefined()
    })
  })
})

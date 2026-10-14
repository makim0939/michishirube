import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '../domain/types'
import { db } from './db'

// アプリ（ファイルを使う）として動かす。ファイルの読み書きは、書いた場所だけ覚える
const files = vi.hoisted(() => ({
  written: [] as string[],
  deleted: [] as string[],
  onWrite: undefined as undefined | ((path: string) => Promise<void>),
}))
vi.mock('./files', () => ({
  usesFiles: true,
  writeBlobFile: async (path: string) => {
    files.written.push(path)
    await files.onWrite?.(path)
  },
  readBlobFile: async () => new Blob(['from file']),
  deleteFile: async (path: string) => {
    files.deleted.push(path)
  },
}))

const { moveContentsToFiles, watchContentFiles } = await import('./content')

function media(over: Partial<Media> = {}): Media {
  return {
    id: 'm1',
    recordId: 'r1',
    skillId: 's1',
    type: 'video/mp4',
    size: 1,
    createdAt: 1,
    updatedAt: 1,
    blob: new Blob(['v1']),
    ...over,
  }
}

/** 行を消したあとのファイル削除は、書き込みが終わってから非同期で行われる */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('動画・写真の中身をアプリのファイルへ移す', () => {
  beforeEach(() => {
    files.written = []
    files.deleted = []
    files.onWrite = undefined
    watchContentFiles()
  })

  it('ファイルに書いて、IndexedDB の中身は消す。同期の対象にはしない', async () => {
    await db.media.add(media())
    await moveContentsToFiles(['m1'])
    const row = await db.media.get('m1')
    expect(row?.file).toBe('media/m1-1.mp4')
    expect(row?.blob).toBeUndefined()
    expect(row?.updatedAt).toBe(1)
    expect(files.deleted).toEqual([])
  })

  it('書いているあいだに中身が差し替わったら、書いたファイルは使わずに消す', async () => {
    await db.media.add(media())
    files.onWrite = async (path) => {
      // 1回目（古い中身）を書いているあいだに、切り取った中身に差し替わる
      if (path === 'media/m1-1.mp4') await db.media.update('m1', { blob: new Blob(['v2']), contentAt: 5 })
    }
    await moveContentsToFiles(['m1'])
    let row = await db.media.get('m1')
    expect(row?.file).toBeUndefined()
    expect(row?.blob).toBeDefined()
    expect(files.deleted).toEqual(['media/m1-1.mp4'])
    // 差し替えた中身は、次に移すときに新しい名前で移る
    await moveContentsToFiles(['m1'])
    row = await db.media.get('m1')
    expect(row?.file).toBe('media/m1-5.mp4')
  })

  it('同時に頼まれても、同じ中身を2回書かない', async () => {
    await db.media.add(media())
    await Promise.all([moveContentsToFiles(), moveContentsToFiles(['m1'])])
    expect(files.written).toEqual(['media/m1-1.mp4'])
  })

  it('行を消す・中身を外すと、そのファイルも消す', async () => {
    await db.media.bulkAdd([
      media({ id: 'a', blob: undefined, file: 'media/a-1.mp4' }),
      media({ id: 'b', blob: undefined, file: 'media/b-1.mp4' }),
    ])
    await db.media.delete('a')
    await db.media.update('b', { file: undefined })
    await settle()
    expect(files.deleted.sort()).toEqual(['media/a-1.mp4', 'media/b-1.mp4'])
  })
})

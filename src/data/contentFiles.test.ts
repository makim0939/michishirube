import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '../domain/types'
import { db } from './db'

// アプリ（ファイルを使う）として動かす。ファイルの読み書きは、書いた場所だけ覚える
const files = vi.hoisted(() => ({
  written: [] as string[],
  deleted: [] as string[],
  listed: [] as string[],
  onWrite: undefined as undefined | ((path: string) => Promise<void>),
  onWipe: undefined as undefined | (() => Promise<void>),
}))
vi.mock('./files', () => ({
  usesFiles: true,
  ContentUnavailableError: class extends Error {},
  writeBlobFile: async (path: string) => {
    files.written.push(path)
    await files.onWrite?.(path)
  },
  readBlobFile: async () => new Blob(['from file']),
  deleteFile: async (path: string) => {
    files.deleted.push(path)
  },
  listContentFiles: async () => files.listed,
  deleteAllContentFiles: async () => {
    await files.onWipe?.()
  },
}))

const { moveContentsToFiles, resetContentFiles, tidyContentFiles, watchContentFiles } = await import('./content')

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
    files.listed = []
    files.onWrite = undefined
    files.onWipe = undefined
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

  it('途中の処理が失敗しても、あとから頼んだ移しは止まらない', async () => {
    await db.media.add(media())
    files.onWipe = async () => {
      throw new Error('消せない')
    }
    await resetContentFiles()
    await moveContentsToFiles(['m1'])
    expect((await db.media.get('m1'))?.file).toBe('media/m1-1.mp4')
  })

  it('全部消して移し直すのは、ほかの移しが終わってから行う', async () => {
    await db.media.add(media())
    const order: string[] = []
    files.onWrite = async (path) => {
      order.push(`write ${path}`)
    }
    files.onWipe = async () => {
      order.push('wipe')
    }
    await Promise.all([moveContentsToFiles(['m1']), resetContentFiles()])
    expect(order).toEqual(['write media/m1-1.mp4', 'wipe'])
  })

  it('この端末の行の使われていないファイルは片付け、中身の無い行の本来のファイルはつなぎ直す', async () => {
    await db.media.bulkAdd([
      media({ id: 'used', blob: undefined, file: 'media/used-1.mp4' }),
      media({ id: 'lost', blob: undefined }),
      media({ id: 'trimmed', blob: undefined, file: 'media/trimmed-9.mp4', contentAt: 9 }),
      media({ id: 'partial' }),
    ])
    files.listed = ['media/used-1.mp4', 'media/lost-1.mp4', 'media/trimmed-1.mp4', 'media/partial-1.mp4']
    await tidyContentFiles()
    expect((await db.media.get('lost'))?.file).toBe('media/lost-1.mp4')
    // 差し替える前の中身と、書きかけ（まだ IndexedDB に中身がある）は消す
    expect(files.deleted.sort()).toEqual(['media/partial-1.mp4', 'media/trimmed-1.mp4'])
  })

  it('まだ行の無いファイルは消さない（同期などで行が戻ってきたら、つなぎ直せるように）', async () => {
    files.listed = ['media/1b2c-3d4e-1700000000000.mp4']
    await tidyContentFiles()
    expect(files.deleted).toEqual([])
    await db.media.add(media({ id: '1b2c-3d4e', blob: undefined, contentAt: 1700000000000 }))
    await tidyContentFiles()
    expect((await db.media.get('1b2c-3d4e'))?.file).toBe('media/1b2c-3d4e-1700000000000.mp4')
  })
})


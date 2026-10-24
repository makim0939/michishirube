import { beforeEach, describe, expect, it } from 'vitest'
import type { Media } from '../domain/types'
import { db } from './db'
import { attachPoster, hasCupImage, needsLocalPoster, needsRemotePoster } from './poster'

const video = (patch: Partial<Media> = {}): Media => ({
  id: 'm',
  recordId: 'r',
  skillId: 's',
  type: 'video/mp4',
  size: 1,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})
const blob = new Blob(['x'])

describe('動画のサムネイル（できあがりのコマ）', () => {
  it('端末に動画があれば、無い・最初のコマのサムネイルを作り直す', () => {
    expect(needsLocalPoster(video({ blob }))).toBe(true)
    expect(needsLocalPoster(video({ blob, poster: blob }))).toBe(true)
    expect(needsLocalPoster(video({ blob, poster: blob, posterEnd: true }))).toBe(false)
  })

  it('端末に動画が無ければ、サーバーにもっとよいサムネイルがあるときだけ取ってくる', () => {
    expect(needsRemotePoster(video({ cloudPoster: true }))).toBe(true)
    expect(needsRemotePoster(video({ poster: blob, cloudPoster: true }))).toBe(false)
    expect(needsRemotePoster(video({ poster: blob, cloudPoster: true, cloudPosterEnd: true }))).toBe(true)
    expect(needsRemotePoster(video({ poster: blob, posterEnd: true, cloudPoster: true, cloudPosterEnd: true }))).toBe(
      false,
    )
  })

  it('今日の大きな写真には、写真だけを使う（動画のコマは使わない）', () => {
    expect(hasCupImage(video({ poster: blob, posterEnd: true }))).toBe(false)
    expect(hasCupImage(video({ cloudPosterEnd: true }))).toBe(false)
    expect(hasCupImage(video({ type: 'image/jpeg', blob }))).toBe(true)
    expect(hasCupImage(video({ type: 'image/jpeg', cloudPhoto: true }))).toBe(true)
    // 取ってこられない（ログインしていない）なら、中身も印も無い写真は、候補にしない（写真の出ない空の枠にならないように）
    expect(hasCupImage(video({ type: 'image/jpeg' }))).toBe(false)
    // 取ってこられるなら、サーバーに置いた印が端末の行に無くても、サーバーにあるかもしれない（取りに行く）
    expect(hasCupImage(video({ type: 'image/jpeg' }), true)).toBe(true)
    expect(hasCupImage(video({ type: 'image/jpeg', size: 3 * 1024 * 1024 }), true)).toBe(false)
  })
})

describe('作ったサムネイルを付ける', () => {
  beforeEach(async () => {
    await db.media.clear()
  })

  it('作っているあいだに動画が差し替わったら、前の動画のサムネイルを付けない', async () => {
    const before = video({ id: 'p1', contentAt: 10 })
    await db.media.put({ ...before, contentAt: 20 })
    expect(await attachPoster(before, blob, true)).toBe(false)
    const row = await db.media.get('p1')
    expect(row?.poster).toBeUndefined()
    expect(row?.posterEnd).toBeUndefined()
  })

  it('中身が同じなら付ける（contentAt が無い行は createdAt で比べる）', async () => {
    const m = video({ id: 'p2' })
    await db.media.put(m)
    expect(await attachPoster(m, blob, true)).toBe(true)
    expect((await db.media.get('p2'))?.posterEnd).toBe(true)
  })

  it('消された動画には付けない', async () => {
    expect(await attachPoster(video({ id: 'gone' }), blob, true)).toBe(false)
    expect(await db.media.get('gone')).toBeUndefined()
  })
})

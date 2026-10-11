import { describe, expect, it } from 'vitest'
import type { Media } from '../domain/types'
import { hasCupImage, needsLocalPoster, needsRemotePoster } from './poster'

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
  })
})

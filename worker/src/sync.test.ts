import { describe, expect, it } from 'vitest'
import { parseSyncRequest } from './sync'

const change = (kind: string, data: unknown, deleted = false) => ({ kind, id: 'x1', updatedAt: 5, deleted, data })

describe('parseSyncRequest', () => {
  it('型の参考の目安・出典は、更新前の端末が送ってきても、保存しない', () => {
    const { changes } = parseSyncRequest({
      since: 0,
      changes: [change('skill', { name: 'ハート', description: '説明', criteria: '10回中8回', sources: [{ title: 't' }] })],
    })
    expect(changes[0].data).toEqual({ name: 'ハート', description: '説明' })
  })

  it('型以外の種類と、削除は、そのまま通す', () => {
    const media = { type: 'image/jpeg', criteria: 'mediaには触らない' }
    const { changes } = parseSyncRequest({
      since: 0,
      changes: [change('media', media), change('skill', undefined, true)],
    })
    expect(changes[0].data).toEqual(media)
    expect(changes[1]).toMatchObject({ deleted: true, data: null })
  })
})

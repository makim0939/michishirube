import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDB } from './db'

/** 前の版（参考の目安・出典が、まだ型にあった頃）の保存場所を作る */
async function oldDb(name: string) {
  const old = new Dexie(name)
  old.version(1).stores({
    domains: 'id, order',
    skills: 'id, domainId, status',
    records: 'id, skillId, createdAt, [skillId+createdAt]',
    media: 'id, recordId, skillId, createdAt',
    meta: 'key',
  })
  old.version(2).stores({ media: 'id, recordId, skillId, createdAt, upload', outbox: '[kind+id]' })
  await old.open()
  return old
}

describe('端末のデータの移行（参考の目安・出典を消す）', () => {
  it('型から参考の目安と出典だけを消し、ほかの項目・更新時刻は変えず、同期の印も付けない', async () => {
    const name = `upgrade-${Math.random()}`
    const old = await oldDb(name)
    await old.table('skills').add({
      id: 's1',
      domainId: 'd1',
      name: 'ハート',
      description: '自分で書いた説明',
      criteria: '10回中8回',
      sources: [{ title: '出典', url: 'https://example.com' }],
      references: [],
      prereqIds: ['s0'],
      status: 'done',
      createdAt: 1,
      updatedAt: 7,
    })
    old.close()

    const next = new AppDB(name)
    const skill = await next.skills.get('s1')
    expect(skill).toEqual({
      id: 's1',
      domainId: 'd1',
      name: 'ハート',
      description: '自分で書いた説明',
      references: [],
      prereqIds: ['s0'],
      status: 'done',
      createdAt: 1,
      updatedAt: 7,
    })
    expect(await next.outbox.count()).toBe(0)
    next.close()
  })
})

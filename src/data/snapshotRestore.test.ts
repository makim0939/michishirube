import { describe, expect, it, vi } from 'vitest'
import type { Media } from '../domain/types'
import { db } from './db'
import { toSnapshot } from './snapshot'

// アプリ（ファイルを使う）として動かす。写しのファイルは、ここで用意した文字を返す
const files = vi.hoisted(() => ({ texts: new Map<string, string>() }))
vi.mock('./files', () => ({
  usesFiles: true,
  readTextFile: async (path: string) => files.texts.get(path),
  writeTextFile: async (path: string, text: string) => {
    files.texts.set(path, text)
  },
}))

const { restoreSnapshotIfEmpty } = await import('./snapshot')

const media: Media = {
  id: 'm1',
  recordId: 'r1',
  skillId: 's1',
  type: 'video/mp4',
  size: 10,
  createdAt: 1,
  updatedAt: 1,
  file: 'media/m1-1.mp4',
}

function snapshotText() {
  return JSON.stringify(
    toSnapshot(
      {
        domains: [{ id: 'd1', name: 'ラテアート', order: 0, createdAt: 1, updatedAt: 1 }],
        skills: [],
        records: [{ id: 'r1', skillId: 's1', reason: '', nextAction: '', mediaIds: ['m1'], createdAt: 1, updatedAt: 1 }],
        media: [media],
        meta: [{ key: 'seeded', value: true }],
      },
      5,
    ),
  )
}

describe('記録の写しから戻す', () => {
  it('画面の中の保存場所が空なら、写しから戻し、同期で送り直す', async () => {
    files.texts = new Map([['snapshot.json', snapshotText()]])
    expect(await restoreSnapshotIfEmpty()).toBe(true)
    expect((await db.records.get('r1'))?.mediaIds).toEqual(['m1'])
    expect((await db.media.get('m1'))?.file).toBe('media/m1-1.mp4')
    expect(await db.outbox.get(['record', 'r1'])).toBeDefined()
  })

  it('写しの型に、参考の目安・出典が残っていても、戻さない', async () => {
    const legacySkill = {
      id: 's1',
      domainId: 'd1',
      name: 'ハート',
      description: '',
      criteria: '10回中8回',
      sources: [{ title: 't' }],
      references: [],
      prereqIds: [],
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
    }
    const snapshot = JSON.parse(snapshotText())
    files.texts = new Map([['snapshot.json', JSON.stringify({ ...snapshot, skills: [legacySkill] })]])
    expect(await restoreSnapshotIfEmpty()).toBe(true)
    const skill = await db.skills.get('s1')
    expect(skill?.name).toBe('ハート')
    expect(skill).not.toHaveProperty('criteria')
    expect(skill).not.toHaveProperty('sources')
  })

  it('入れ替えの途中で止まっていたら、一時ファイルから戻す', async () => {
    files.texts = new Map([['snapshot.json.tmp', snapshotText()]])
    expect(await restoreSnapshotIfEmpty()).toBe(true)
    expect(await db.records.count()).toBe(1)
  })

  it('記録が残っていれば、写しで上書きしない', async () => {
    files.texts = new Map([['snapshot.json', snapshotText()]])
    await db.domains.add({ id: 'd2', name: 'ピアノ', order: 0, createdAt: 2, updatedAt: 2 })
    expect(await restoreSnapshotIfEmpty()).toBe(false)
    expect(await db.records.count()).toBe(0)
  })
})

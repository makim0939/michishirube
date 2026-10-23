import { describe, expect, it } from 'vitest'
import { parseSyncRequest, sync } from './sync'

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

describe('sync（D1 に書き込む）', () => {
  const record = (updatedAt: number, note: string, deleted = false) => ({
    kind: 'record' as const,
    id: 'r1',
    updatedAt,
    deleted,
    data: deleted ? null : { note },
  })

  async function setup() {
    const { testD1 } = await import('./testD1')
    const db = await testD1()
    await db.prepare("INSERT INTO users (id, google_sub, created_at) VALUES ('u1', 'g1', 0)").run()
    return db
  }

  it('送った変更が古くて負けたら、勝ったほうを、その応答で送った端末に返し直す', async () => {
    const db = await setup()
    // 端末 A が新しい版を書き、端末 B はそれをすでに受け取った（cursor が先へ進んだ）
    const first = await sync(db, 'u1', { since: 0, changes: [record(200, '新しい')] })
    // B の時計が遅れていて、B の編集は古い時刻で届く
    const res = await sync(db, 'u1', { since: first.cursor, changes: [record(100, '時計の遅れた端末の編集')] })
    expect(res.changes).toEqual([{ kind: 'record', id: 'r1', updatedAt: 200, deleted: false, data: { note: '新しい' } }])
    expect(res.cursor).toBeGreaterThan(first.cursor)
  })

  it('負けた削除は、行を消さずに残し、送った端末に残っているほうを返す', async () => {
    const db = await setup()
    const first = await sync(db, 'u1', { since: 0, changes: [record(200, '残す')] })
    const res = await sync(db, 'u1', { since: first.cursor, changes: [record(100, '', true)] })
    expect(res.changes).toMatchObject([{ id: 'r1', updatedAt: 200, deleted: false, data: { note: '残す' } }])
  })

  it('新しい変更は、これまで通り上書きする', async () => {
    const db = await setup()
    const first = await sync(db, 'u1', { since: 0, changes: [record(100, '古い')] })
    const res = await sync(db, 'u1', { since: first.cursor, changes: [record(200, '新しい')] })
    expect(res.changes).toMatchObject([{ updatedAt: 200, data: { note: '新しい' } }])
  })

  it('同期の途中でアカウントが削除されていたら、書いた行を残さない', async () => {
    const db = await setup()
    await db.prepare("DELETE FROM users WHERE id = 'u1'").run()
    await sync(db, 'u1', { since: 0, changes: [record(100, '消えたアカウント')] })
    expect(await db.prepare("SELECT COUNT(*) AS n FROM user_entities WHERE user_id = 'u1'").first<{ n: number }>()).toEqual({ n: 0 })
  })
})

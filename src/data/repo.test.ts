import { describe, expect, it } from 'vitest'
import { exportBackup, importBackup } from './backup'
import { db } from './db'
import {
  achieveSkill,
  activateSkill,
  addRecord,
  createDomain,
  createSkill,
  deleteRecord,
  deleteSkill,
  ensureSeeded,
  lastNextAction,
  recordsOf,
  revertAchievement,
  setMaxActive,
  updateSkill,
} from './repo'

const input = (name: string, prereqIds: string[] = []) => ({ name, description: '', criteria: '', sources: [], prereqIds })

async function chain() {
  const domainId = await createDomain('ピアノ')
  const a = await createSkill(domainId, input('A'))
  const b = await createSkill(domainId, input('B', [a]))
  const c = await createSkill(domainId, input('C', [b]))
  return { domainId, a, b, c }
}

describe('ensureSeeded', () => {
  it('初回だけラテアートを入れ、削除後に再実行しても復活しない', async () => {
    await ensureSeeded()
    expect((await db.domains.toArray()).map((d) => d.name)).toEqual(['ラテアート'])
    await db.domains.clear()
    await ensureSeeded()
    expect(await db.domains.count()).toBe(0)
  })
})

describe('挑戦と達成', () => {
  it('達成すると次が解放され、取り消すと前提の崩れた挑戦中スキルが外れる', async () => {
    const { a, b, c } = await chain()
    await expect(activateSkill(b)).rejects.toThrow(/前提/)
    await activateSkill(a)
    const { unlocked } = await achieveSkill(a)
    expect(unlocked.map((s) => s.id)).toEqual([b])

    await activateSkill(b)
    await revertAchievement(a)
    expect((await db.skills.get(b))!.status).toBe('idle')
    await expect(achieveSkill(c)).rejects.toThrow(/前提/)
  })

  it('挑戦中の上限を超えられない', async () => {
    const domainId = await createDomain('ギター')
    const ids = await Promise.all(['A', 'B', 'C'].map((n) => createSkill(domainId, input(n))))
    await setMaxActive(2)
    await activateSkill(ids[0])
    await activateSkill(ids[1])
    await expect(activateSkill(ids[2])).rejects.toThrow(/上限/)
  })

  it('循環する前提には変更できない', async () => {
    const { a, c } = await chain()
    await expect(updateSkill(a, input('A', [c]))).rejects.toThrow(/循環/)
  })

  it('スキルを消すと、それを前提にしていたスキルの前提からも外れる', async () => {
    const { a, b } = await chain()
    await deleteSkill(a)
    expect((await db.skills.get(b))!.prereqIds).toEqual([])
  })
})

describe('記録', () => {
  it('前回の「次の一手」は、空の記録を飛ばして最新のものを返す', async () => {
    const { a } = await chain()
    await addRecord({ skillId: a, reason: '', nextAction: 'ピッチャーを近づける', files: [] })
    await new Promise((r) => setTimeout(r, 2))
    await addRecord({ skillId: a, outcome: 'bad', reason: '泡が粗い', nextAction: '', files: [] })
    expect((await lastNextAction(a))?.text).toBe('ピッチャーを近づける')
    expect(await recordsOf(a)).toHaveLength(2)
  })

  it('空の記録は保存できない', async () => {
    const { a } = await chain()
    await expect(addRecord({ skillId: a, reason: ' ', nextAction: '', files: [] })).rejects.toThrow()
  })

  it('記録を消すと動画・写真も消える', async () => {
    const { a } = await chain()
    const id = await addRecord({ skillId: a, reason: 'x', nextAction: '', files: [new Blob(['v'], { type: 'video/mp4' })] })
    expect(await db.media.count()).toBe(1)
    await deleteRecord(id)
    expect(await db.media.count()).toBe(0)
  })
})

describe('バックアップ', () => {
  it('書き出して読み込むと、動画を含めて元に戻る', async () => {
    const { a, domainId } = await chain()
    await setMaxActive(4)
    await addRecord({
      skillId: a,
      outcome: 'good',
      reason: '温度が合った',
      nextAction: '同じ手順で3回',
      files: [new Blob(['movie-bytes'], { type: 'video/quicktime' })],
    })
    const zip = await exportBackup({ includeMedia: true })

    await db.domains.clear()
    await db.media.clear()
    const summary = await importBackup(zip)
    expect(summary).toMatchObject({ domains: 1, skills: 3, records: 1, media: 1, missingMedia: 0 })
    expect((await db.domains.get(domainId))?.name).toBe('ピアノ')
    const [m] = await db.media.toArray()
    expect(m.type).toBe('video/quicktime')
    expect(await m.blob.text()).toBe('movie-bytes')
    expect((await db.meta.get('settings'))?.value).toMatchObject({ maxActive: 4 })
  })

  it('メディアを含めない書き出しでは、記録からメディアへの参照を外す', async () => {
    const { a } = await chain()
    await addRecord({ skillId: a, reason: 'x', nextAction: '', files: [new Blob(['v'], { type: 'image/jpeg' })] })
    const summary = await importBackup(await exportBackup({ includeMedia: false }))
    expect(summary).toMatchObject({ media: 0, missingMedia: 1 })
    expect((await db.records.toArray())[0].mediaIds).toEqual([])
  })

  it('別の ZIP や壊れたファイルは読み込まない', async () => {
    await expect(importBackup(new Blob(['not a zip']))).rejects.toThrow()
  })
})

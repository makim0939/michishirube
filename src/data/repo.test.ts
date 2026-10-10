import { describe, expect, it } from 'vitest'
import { exportBackup, importBackup } from './backup'
import { db } from './db'
import {
  achieveSkill,
  activateSkill,
  addReference,
  removeReference,
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
  it('前提が挑戦中なら並行して挑戦できるが、達成は前提を達成してから', async () => {
    const { a, b, c } = await chain()
    await expect(activateSkill(b)).rejects.toThrow(/前提/)
    await activateSkill(a)
    await activateSkill(b)
    await expect(achieveSkill(b)).rejects.toThrow(/前提/)

    const { unlocked } = await achieveSkill(a)
    expect(unlocked.map((s) => s.id)).toEqual([b])
    await achieveSkill(b)

    // 達成を取り消しても、挑戦中のものは勝手に外さない
    await activateSkill(c)
    await revertAchievement(b)
    expect((await db.skills.get(c))!.status).toBe('active')
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
    const parts = await exportBackup({ includeMedia: true })
    expect(parts).toHaveLength(1)
    expect(parts[0].name).toMatch(/^michishirube-full-\d{8}-\d{4}\.zip$/)

    await db.domains.clear()
    await db.media.clear()
    const summary = await importBackup(parts.map((p) => p.blob))
    expect(summary).toMatchObject({ domains: 1, skills: 3, records: 1, media: 1, missingMedia: 0 })
    expect((await db.domains.get(domainId))?.name).toBe('ピアノ')
    const [m] = await db.media.toArray()
    expect(m.type).toBe('video/quicktime')
    expect(await m.blob!.text()).toBe('movie-bytes')
    expect((await db.meta.get('settings'))?.value).toMatchObject({ maxActive: 4 })
  })

  it('メディアを含めない書き出しでは、中身のないメディアとして戻す（YouTube やサーバーの写真は見られる）', async () => {
    const { a } = await chain()
    await addRecord({ skillId: a, reason: 'x', nextAction: '', files: [new Blob(['v'], { type: 'image/jpeg' })] })
    const parts = await exportBackup({ includeMedia: false })
    const summary = await importBackup(parts.map((p) => p.blob))
    expect(summary).toMatchObject({ media: 0, missingMedia: 0 })
    const [m] = await db.media.toArray()
    expect(m.blob).toBeUndefined()
    expect((await db.records.toArray())[0].mediaIds).toEqual([m.id])
  })

  it('上限を超える分は別の ZIP に分け、全部そろえると元に戻る', async () => {
    const { a } = await chain()
    for (const text of ['first-video', 'second-video', 'third-video']) {
      await addRecord({ skillId: a, reason: text, nextAction: '', files: [new Blob([text], { type: 'video/mp4' })] })
    }
    const parts = await exportBackup({ includeMedia: true, partLimit: 1 })
    expect(parts.map((p) => p.name.replace(/^.*-(\d+of\d+)\.zip$/, '$1'))).toEqual(['1of3', '2of3', '3of3'])

    const all = await importBackup(parts.map((p) => p.blob))
    expect(all).toMatchObject({ media: 3, missingMedia: 0 })
    expect((await db.media.toArray()).map((m) => m.size).sort()).toEqual([11, 11, 12])

    // 一部の ZIP が欠けていても、ある分だけ戻して欠けた件数を返す
    const partial = await importBackup(parts.slice(0, 2).map((p) => p.blob))
    expect(partial).toMatchObject({ media: 2, missingMedia: 1 })
  })

  it('別の ZIP や壊れたファイル、別々のバックアップの混在は読み込まない', async () => {
    await expect(importBackup([new Blob(['not a zip'])])).rejects.toThrow()
    await chain()
    const [first] = await exportBackup({ includeMedia: false })
    const [second] = await exportBackup({ includeMedia: false })
    await expect(importBackup([first.blob, second.blob])).rejects.toThrow(/混ざって/)
  })
})

describe('参考資料', () => {
  it('URL を検査し、タイトルが無ければサービス名にする。追加・削除は同期の対象になる', async () => {
    const { a } = await chain()
    await expect(addReference(a, { url: 'javascript:alert(1)' })).rejects.toThrow(/http/)
    await db.outbox.clear()
    await addReference(a, { url: 'https://youtu.be/abc', note: '2:30〜' })
    await addReference(a, { url: 'https://www.example.com/latte', title: '注ぎ方の記事' })
    const [first, second] = (await db.skills.get(a))!.references
    expect(first).toMatchObject({ title: 'YouTube の動画', note: '2:30〜' })
    expect(second.title).toBe('注ぎ方の記事')
    expect(await db.outbox.get(['skill', a])).toBeDefined()

    await removeReference(a, first.id)
    expect((await db.skills.get(a))!.references.map((r) => r.id)).toEqual([second.id])
  })
})

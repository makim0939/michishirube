import { describe, expect, it, vi } from 'vitest'
import { exportBackup, importBackup } from './backup'
import { db } from './db'
import {
  achieveSkill,
  practicingSkillIds,
  addRecord,
  addReference,
  createDomain,
  createSkill,
  cupNumbers,
  deleteRecord,
  deleteSkill,
  ensureSeeded,
  lastNextAction,
  recordsOf,
  removeReference,
  revertAchievement,
  updateRecord,
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
  it('前提はおすすめの順で、まだの型でも「できた」にできる', async () => {
    const { a, b, c } = await chain()
    // b ができると、b を前提にする型（おすすめになった型）を返す
    const { unlocked } = await achieveSkill(b)
    expect(unlocked.map((s) => s.id)).toEqual([c])
    await achieveSkill(a)
    await revertAchievement(b)
    expect((await db.skills.get(b))!.status).toBe('idle')
  })

  it('練習中は、最近記録した型。最近の記録が無ければ、最後に記録した型', async () => {
    const { a, b } = await chain()
    expect([...(await practicingSkillIds())]).toEqual([])
    await addRecord({ skillId: a, outcome: 'good', reason: '', nextAction: '', files: [] })
    // 同じ時刻にならないよう、少し待ってから記録する（どちらが最後かを決めるため）
    await new Promise((r) => setTimeout(r, 5))
    await addRecord({ skillId: b, outcome: 'good', reason: '', nextAction: '', files: [] })
    expect([...(await practicingSkillIds())].sort()).toEqual([a, b].sort())
    // 30日たつと、最後に記録した型（b）だけが練習中に残る
    const later = Date.now() + 30 * 24 * 60 * 60 * 1000
    expect([...(await practicingSkillIds(later))]).toEqual([b])
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

  it('撮るときに選んだ画質と公開範囲は、その動画だけに付く（選ばなければ付かない）', async () => {
    const { a } = await chain()
    await addRecord({
      skillId: a,
      reason: '',
      nextAction: '',
      files: [
        { blob: new Blob(['v'], { type: 'video/mp4' }), quality: 'high', youtubePrivacy: 'public' },
        { blob: new Blob(['w'], { type: 'video/mp4' }) },
      ],
    })
    const rows = await db.media.orderBy('createdAt').toArray()
    expect(rows[0]).toMatchObject({ quality: 'high', youtubePrivacy: 'public' })
    expect(rows[1].quality).toBeUndefined()
    expect(rows[1].youtubePrivacy).toBeUndefined()
  })
})

describe('バックアップ', () => {
  it('書き出して読み込むと、動画を含めて元に戻る', async () => {
    const { a, domainId } = await chain()
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

describe('記録を直す', () => {
  it('結果・理由・次の一手を直し、動画・写真を足す・外す・差し替える', async () => {
    const { a } = await chain()
    const id = await addRecord({
      skillId: a,
      outcome: 'bad',
      reason: '泡が粗い',
      nextAction: '',
      files: [new Blob(['photo'], { type: 'image/jpeg' }), new Blob(['video'], { type: 'video/mp4' })],
    })
    const [photo, video] = (await db.records.get(id))!.mediaIds
    await db.media.update(video, { upload: 'done', youtubeId: 'yt-old' })
    await db.outbox.clear()

    await updateRecord({
      recordId: id,
      outcome: 'good',
      reason: '温度が合った',
      nextAction: '同じ手順で3回',
      addFiles: [{ blob: new Blob(['new-video'], { type: 'video/mp4' }), poster: new Blob(['p'], { type: 'image/jpeg' }) }],
      removeMediaIds: [photo],
      replace: [{ id: video, blob: new Blob(['trimmed'], { type: 'video/mp4' }) }],
    })

    const record = (await db.records.get(id))!
    expect(record).toMatchObject({ outcome: 'good', reason: '温度が合った', nextAction: '同じ手順で3回' })
    expect(record.mediaIds).toHaveLength(2)
    expect(record.mediaIds).not.toContain(photo)
    expect(await db.media.get(photo)).toBeUndefined()
    // 切り取った動画は中身が変わり、YouTube に上げ直す
    const trimmed = (await db.media.get(video))!
    expect(await trimmed.blob!.text()).toBe('trimmed')
    expect(trimmed).toMatchObject({ upload: 'pending' })
    expect(trimmed.youtubeId).toBeUndefined()
    const added = (await db.media.get(record.mediaIds[1]))!
    expect(added).toMatchObject({ upload: 'pending', recordId: id })
    expect(await added.poster!.text()).toBe('p')
    // 消したもの・足したもの・差し替えたもの・記録が同期の対象になる
    expect((await db.outbox.toArray()).map((e) => e.id).sort()).toEqual([photo, video, added.id, id].sort())
  })

  it('型を付け替えると、記録と動画・写真が新しい型に移り、同期の対象になる', async () => {
    const { a, b } = await chain()
    const id = await addRecord({
      skillId: a,
      reason: '',
      nextAction: '',
      files: [new Blob(['v'], { type: 'video/mp4' }), new Blob(['p'], { type: 'image/jpeg' })],
    })
    const mediaIds = (await db.records.get(id))!.mediaIds
    await db.outbox.clear()

    await updateRecord({ recordId: id, skillId: b, reason: '', nextAction: '', addFiles: [], removeMediaIds: [], replace: [] })

    expect((await db.records.get(id))!.skillId).toBe(b)
    for (const m of mediaIds) expect((await db.media.get(m))!.skillId).toBe(b)
    expect(await recordsOf(a)).toHaveLength(0)
    expect(await recordsOf(b)).toHaveLength(1)
    expect((await db.outbox.toArray()).map((e) => e.id).sort()).toEqual([...mediaIds, id].sort())
  })

  it('型を付け替えるとき、足した動画・写真も新しい型になる', async () => {
    const { a, b } = await chain()
    const id = await addRecord({ skillId: a, reason: 'x', nextAction: '', files: [] })
    await updateRecord({
      recordId: id,
      skillId: b,
      reason: 'x',
      nextAction: '',
      addFiles: [{ blob: new Blob(['v'], { type: 'video/mp4' }) }],
      removeMediaIds: [],
      replace: [],
    })
    const [added] = (await db.records.get(id))!.mediaIds
    expect((await db.media.get(added))!.skillId).toBe(b)
  })

  it('型を付け替えるとき、外した動画は戻らず、切り取った動画も新しい型になる', async () => {
    const { a, b } = await chain()
    const id = await addRecord({
      skillId: a,
      reason: '',
      nextAction: '',
      files: [new Blob(['v'], { type: 'video/mp4' }), new Blob(['p'], { type: 'image/jpeg' })],
    })
    const [video, photo] = (await db.records.get(id))!.mediaIds
    await db.outbox.clear()

    await updateRecord({
      recordId: id,
      skillId: b,
      reason: '',
      nextAction: '',
      addFiles: [],
      removeMediaIds: [photo],
      replace: [{ id: video, blob: new Blob(['trimmed'], { type: 'video/mp4' }) }],
    })

    expect(await db.media.get(photo)).toBeUndefined()
    expect((await db.media.get(video))!.skillId).toBe(b)
    expect((await db.records.get(id))!.mediaIds).toEqual([video])
    expect((await db.outbox.toArray()).map((e) => e.id).sort()).toEqual([photo, video, id].sort())
  })

  it('無い型には付け替えられない', async () => {
    const { a } = await chain()
    const id = await addRecord({ skillId: a, reason: 'x', nextAction: '', files: [] })
    await expect(
      updateRecord({ recordId: id, skillId: 'nothing', reason: 'x', nextAction: '', addFiles: [], removeMediaIds: [], replace: [] }),
    ).rejects.toThrow(/型が見つかりません/)
    expect((await db.records.get(id))!.skillId).toBe(a)
  })

  it('全部消して空にはできない', async () => {
    const { a } = await chain()
    const id = await addRecord({ skillId: a, reason: '', nextAction: '', files: [new Blob(['v'], { type: 'video/mp4' })] })
    const [m] = (await db.records.get(id))!.mediaIds
    await expect(
      updateRecord({ recordId: id, reason: ' ', nextAction: '', addFiles: [], removeMediaIds: [m], replace: [] }),
    ).rejects.toThrow(/1つ以上/)
  })
})

describe('杯の通し番号', () => {
  it('型に関係なく、全部の記録の中で古いほうから何杯目かを返す', async () => {
    const { a, b } = await chain()
    const ids: string[] = []
    vi.useFakeTimers({ toFake: ['Date'] })
    for (const [skillId, i] of [[a, 0], [b, 1], [a, 2]] as const) {
      vi.setSystemTime(new Date(2026, 0, 1 + i))
      ids.push(await addRecord({ skillId, reason: 'x', nextAction: '', files: [] }))
    }
    vi.useRealTimers()
    const records = await db.records.bulkGet(ids)
    const numbers = await cupNumbers(records.filter((r) => !!r))
    expect(ids.map((id) => numbers.get(id))).toEqual([1, 2, 3])
  })

  it('同じ日時の記録があっても、番号が重ならない', async () => {
    const { a } = await chain()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 1))
    const ids = [
      await addRecord({ skillId: a, reason: 'x', nextAction: '', files: [] }),
      await addRecord({ skillId: a, reason: 'y', nextAction: '', files: [] }),
    ]
    vi.useRealTimers()
    const numbers = await cupNumbers((await db.records.bulkGet(ids)).filter((r) => !!r))
    expect(new Set(ids.map((id) => numbers.get(id)))).toEqual(new Set([1, 2]))
  })
})

describe('原因', () => {
  it('選んだ原因を記録に残し、原因だけでも記録できる', async () => {
    const { a } = await chain()
    const id = await addRecord({ skillId: a, reason: '', nextAction: '', causes: ['熱すぎた'], files: [] })
    expect((await db.records.get(id))?.causes).toEqual(['熱すぎた'])
    await updateRecord({
      recordId: id,
      reason: '',
      causes: ['熱すぎた', '切り'],
      nextAction: '',
      addFiles: [],
      removeMediaIds: [],
      replace: [],
    })
    expect((await db.records.get(id))?.causes).toEqual(['熱すぎた', '切り'])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { pickRecorderMimeType } from './mediaPrep'
import { addRecord, createDomain, createSkill, ensureSeeded, setMediaKeep } from './repo'
import { applyRemote, connectSync, runSync } from './sync'
import { selectVideosToDrop } from './tidy'
import { uploadVideo } from './youtube'

const input = (name: string) => ({ name, description: '', criteria: '', sources: [], prereqIds: [] })

afterEach(() => {
  vi.unstubAllGlobals()
})

/** サーバーの代わり。entities を持ち、sync の要求に応える */
function fakeServer() {
  const rows = new Map<string, { kind: string; id: string; updatedAt: number; deleted: boolean; data: unknown; seq: number }>()
  let seq = 0
  const handler = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname
    if (path === '/api/health') return Response.json({ ok: true })
    if (path === '/api/sync') {
      const body = JSON.parse(String(init?.body)) as {
        since: number
        changes: { kind: string; id: string; updatedAt: number; deleted: boolean; data?: unknown }[]
      }
      for (const c of body.changes) {
        const key = `${c.kind}:${c.id}`
        const cur = rows.get(key)
        if (!cur || c.updatedAt > cur.updatedAt) rows.set(key, { ...c, data: c.deleted ? null : c.data, seq: ++seq })
      }
      const changes = [...rows.values()].filter((r) => r.seq > body.since).sort((a, b) => a.seq - b.seq)
      return Response.json({ cursor: changes.at(-1)?.seq ?? body.since, more: false, changes })
    }
    if (path.startsWith('/api/photos/')) return Response.json({ ok: true })
    return new Response('not found', { status: 404 })
  }
  return { rows, fetch: vi.fn(handler) }
}

describe('同期', () => {
  it('1台目は全部送り、変更と削除も送る', async () => {
    const server = fakeServer()
    vi.stubGlobal('fetch', server.fetch)
    const domainId = await createDomain('ピアノ')
    const skillId = await createSkill(domainId, input('スケール'))
    expect(await connectSync({ url: 'https://api.example', token: 't' })).toEqual({ firstDevice: true })
    expect(server.rows.get(`skill:${skillId}`)?.deleted).toBe(false)
    expect(await db.outbox.count()).toBe(0)

    await db.skills.delete(skillId)
    await db.outbox.put({ kind: 'skill', id: skillId, at: Date.now() + 1000 })
    await runSync()
    expect(server.rows.get(`skill:${skillId}`)?.deleted).toBe(true)
  })

  it('2台目は自分の初期データを捨てて、サーバーの内容を受け取る', async () => {
    const server = fakeServer()
    vi.stubGlobal('fetch', server.fetch)
    server.rows.set('domain:remote', {
      kind: 'domain',
      id: 'remote',
      updatedAt: 5,
      deleted: false,
      data: { id: 'remote', name: 'ラテアート', order: 1, createdAt: 1 },
      seq: 1,
    })
    await ensureSeeded()
    expect(await db.domains.count()).toBe(1)
    expect(await connectSync({ url: 'https://api.example', token: 't' })).toEqual({ firstDevice: false })
    expect((await db.domains.toArray()).map((d) => d.id)).toEqual(['remote'])
  })

  it('新しいほうを残し、写真の中身は端末のものを保つ', async () => {
    const domainId = await createDomain('ピアノ')
    const recordId = await addRecord({
      skillId: await createSkill(domainId, input('A')),
      reason: 'x',
      nextAction: '',
      files: [new Blob(['photo'], { type: 'image/jpeg' })],
    })
    const [m] = await db.media.where('recordId').equals(recordId).toArray()
    await applyRemote([
      { kind: 'domain', id: domainId, updatedAt: 1, deleted: false, data: { name: '古い名前' } },
      { kind: 'media', id: m.id, updatedAt: m.updatedAt + 1, deleted: false, data: { ...m, blob: undefined, keep: true } },
    ])
    expect((await db.domains.get(domainId))?.name).toBe('ピアノ')
    const after = await db.media.get(m.id)
    expect(after?.keep).toBe(true)
    expect(await after?.blob?.text()).toBe('photo')
  })
})

describe('記録の印', () => {
  it('残す印を付けると同期の対象になる', async () => {
    const domainId = await createDomain('ピアノ')
    await addRecord({
      skillId: await createSkill(domainId, input('A')),
      reason: '',
      nextAction: '',
      files: [new Blob(['v'], { type: 'video/mp4' })],
    })
    const [m] = await db.media.toArray()
    expect(m.upload).toBe('pending')
    await db.outbox.clear()
    await setMediaKeep(m.id, true)
    expect(await db.outbox.get(['media', m.id])).toBeDefined()
  })
})

describe('動画の自動整理', () => {
  const day = 24 * 60 * 60 * 1000
  const now = 100 * day
  const video = (id: string, daysAgo: number, extra: object = {}) => ({
    id,
    skillId: 's',
    type: 'video/mp4',
    createdAt: now - daysAgo * day,
    youtubeId: `yt-${id}`,
    hasBlob: true,
    ...extra,
  })

  it('最初の1本・最新3本・残す印・上げていないもの・新しいものは消さない', () => {
    const media = [
      video('first', 60),
      video('old1', 50),
      video('old2', 40, { keep: true }),
      video('old3', 30, { youtubeId: undefined }),
      video('old4', 20),
      video('recent1', 3),
      video('recent2', 2),
      video('recent3', 1),
    ]
    expect(selectVideosToDrop(media, now).sort()).toEqual(['old1', 'old4'])
  })
})

describe('録画の形式', () => {
  it('MP4 を優先し、無ければ WebM', () => {
    expect(pickRecorderMimeType((t) => t.startsWith('video/mp4'))).toMatch(/^video\/mp4/)
    expect(pickRecorderMimeType((t) => t === 'video/webm')).toBe('video/webm')
    expect(pickRecorderMimeType(() => false)).toBeUndefined()
  })
})

describe('YouTube へのアップロード', () => {
  it('再開可能アップロードで、受け取ったアップロード先に動画を送る', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) return new Response(null, { status: 200, headers: { Location: 'https://upload.example/session' } })
      return Response.json({ id: 'abc123' })
    }) as unknown as typeof fetch
    const id = await uploadVideo(new Blob(['v'], { type: 'video/mp4' }), { title: 't', description: 'd' }, 'token', fetchImpl)
    expect(id).toBe('abc123')
    expect(JSON.parse(String(calls[0].init?.body)).status.privacyStatus).toBe('private')
    expect(calls[1].url).toBe('https://upload.example/session')
  })

  it('上限に達したら専用のエラーにする', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 }),
    ) as unknown as typeof fetch
    await expect(uploadVideo(new Blob(['v']), { title: 't', description: '' }, 'token', fetchImpl)).rejects.toThrow(
      /上限/,
    )
  })
})

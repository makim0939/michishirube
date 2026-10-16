import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportBackup, importBackup } from './backup'
import { db } from './db'
import { pickRecorderMimeType } from './mediaPrep'
import { addRecord, createDomain, createSkill, ensureSeeded } from './repo'
import { getVideoStorage, setVideoStorage, setYoutubePrivacy } from './videoStorage'
import { applyRemote, connectWithConfig, runSync } from './sync'
import { selectVideosToDrop } from './tidy'
import { uploadVideo, videoMeta, youtubePlayable } from './youtube'

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
    expect(await connectWithConfig({ url: 'https://api.example', token: 't' })).toEqual({ firstDevice: true })
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
    expect(await connectWithConfig({ url: 'https://api.example', token: 't' })).toEqual({ firstDevice: false })
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

describe('同期が止まらないようにする', () => {
  it('写真の置ける量を超えても、記録の同期は続ける', async () => {
    const server = fakeServer()
    const base = server.fetch.getMockImplementation()!
    server.fetch.mockImplementation(async (url: string, init?: RequestInit) =>
      new URL(url).pathname.startsWith('/api/photos/') && init?.method === 'PUT'
        ? Response.json({ error: 'quota' }, { status: 413 })
        : base(url, init),
    )
    vi.stubGlobal('fetch', server.fetch)
    const domainId = await createDomain('ピアノ')
    const recordId = await addRecord({
      skillId: await createSkill(domainId, input('A')),
      reason: 'x',
      nextAction: '',
      files: [new Blob(['photo'], { type: 'image/jpeg' })],
    })
    await connectWithConfig({ url: 'https://api.example', token: 't' })
    expect(server.rows.get(`record:${recordId}`)?.deleted).toBe(false)
    expect(await db.outbox.count()).toBe(0)
  })

  it('サーバーが受け付けない大きさのものは送らず、ほかの変更は送る', async () => {
    const server = fakeServer()
    vi.stubGlobal('fetch', server.fetch)
    const domainId = await createDomain('ピアノ')
    const big = await createSkill(domainId, { ...input('大きい'), description: 'あ'.repeat(70 * 1024) })
    const small = await createSkill(domainId, input('小さい'))
    await connectWithConfig({ url: 'https://api.example', token: 't' })
    expect(server.rows.has(`skill:${big}`)).toBe(false)
    expect(server.rows.get(`skill:${small}`)?.deleted).toBe(false)
  })

  it('分野・型が後ろのページにあっても、2台目と分かる', async () => {
    const server = fakeServer()
    const base = server.fetch.getMockImplementation()!
    // 1ページに1件だけ返すサーバー
    server.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname !== '/api/sync') return base(url, init)
      const body = JSON.parse(String(init?.body)) as { since: number; changes: unknown[] }
      if (body.changes.length > 0) return base(url, init)
      const all = [...server.rows.values()].filter((r) => r.seq > body.since).sort((a, b) => a.seq - b.seq)
      return Response.json({ cursor: all[0]?.seq ?? body.since, more: all.length > 1, changes: all.slice(0, 1) })
    })
    vi.stubGlobal('fetch', server.fetch)
    server.rows.set('record:r', { kind: 'record', id: 'r', updatedAt: 5, deleted: false, data: { id: 'r' }, seq: 1 })
    server.rows.set('domain:remote', {
      kind: 'domain',
      id: 'remote',
      updatedAt: 5,
      deleted: false,
      data: { id: 'remote', name: 'ラテアート', order: 1, createdAt: 1 },
      seq: 2,
    })
    await ensureSeeded()
    expect(await connectWithConfig({ url: 'https://api.example', token: 't' })).toEqual({ firstDevice: false })
  })
})

describe('動画のサムネイル', () => {
  it('サムネイルをサーバーに置き、cloudPoster を立てて同期する', async () => {
    const server = fakeServer()
    vi.stubGlobal('fetch', server.fetch)
    const domainId = await createDomain('ピアノ')
    const recordId = await addRecord({
      skillId: await createSkill(domainId, input('A')),
      reason: 'x',
      nextAction: '',
      files: [new Blob(['video'], { type: 'video/mp4' })],
    })
    const [m] = await db.media.where('recordId').equals(recordId).toArray()
    await db.media.update(m.id, { poster: new Blob(['poster'], { type: 'image/jpeg' }) })
    await connectWithConfig({ url: 'https://api.example', token: 't' })
    await runSync()
    const puts = server.fetch.mock.calls.filter(([url, init]) => String(url).includes('/api/photos/') && init?.method === 'PUT')
    expect(puts.map(([url]) => new URL(String(url)).pathname)).toContain(`/api/photos/${m.id}.poster`)
    expect((await db.media.get(m.id))?.cloudPoster).toBe(true)
    expect((server.rows.get(`media:${m.id}`)?.data as { cloudPoster?: boolean }).cloudPoster).toBe(true)
    // 前の作り方（最初のコマ）なので、できあがりのコマとは扱わない。サムネイルは同期の中身に含めない
    expect((await db.media.get(m.id))?.cloudPosterEnd).toBe(false)
    expect((server.rows.get(`media:${m.id}`)?.data as { poster?: unknown; posterEnd?: unknown }).posterEnd).toBeUndefined()

    // できあがりのコマで作り直したら、置き直して cloudPosterEnd を立てる
    await db.media.update(m.id, { poster: new Blob(['end'], { type: 'image/jpeg' }), posterEnd: true })
    await runSync()
    expect((await db.media.get(m.id))?.cloudPosterEnd).toBe(true)
  })
})

describe('動画の保存先', () => {
  it('選んでいなければ、YouTube に上げた動画がある端末は YouTube、無ければ端末', async () => {
    const domainId = await createDomain('ピアノ')
    await addRecord({
      skillId: await createSkill(domainId, input('A')),
      reason: '',
      nextAction: '',
      files: [new Blob(['v'], { type: 'video/mp4' })],
    })
    expect(await getVideoStorage()).toBe('device')
    const [m] = await db.media.toArray()
    await db.media.update(m.id, { upload: 'done', youtubeId: 'yt1' })
    expect(await getVideoStorage()).toBe('youtube')
    // 選んだら、そちらを使う
    await setVideoStorage('device')
    expect(await getVideoStorage()).toBe('device')
  })
})

describe('動画の自動整理', () => {
  const day = 24 * 60 * 60 * 1000
  const now = 100 * day
  const video = (id: string, daysAgo: number, extra: object = {}) => ({
    id,
    type: 'video/mp4',
    createdAt: now - daysAgo * day,
    upload: 'done' as const,
    youtubeId: `yt-${id}`,
    hasBlob: true,
    ...extra,
  })

  it('YouTube に上げ終えて3日たった動画だけを消す', () => {
    const media = [
      video('old', 30),
      video('just', 4),
      video('recent', 2),
      video('notUploaded', 30, { upload: 'pending', youtubeId: undefined }),
      video('gone', 30, { hasBlob: false }),
      video('edited', 30, { contentAt: now - 1 * day }),
      video('photo', 30, { type: 'image/jpeg' }),
    ]
    expect(selectVideosToDrop(media, now).sort()).toEqual(['just', 'old'])
  })

  it('YouTube で再生できると確かめられた動画だけを消せる', async () => {
    const reply = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch
    expect(await youtubePlayable('a', reply(200))).toBe(true)
    // 非公開・処理の失敗・削除
    expect(await youtubePlayable('a', reply(401))).toBe(false)
    expect(await youtubePlayable('a', reply(404))).toBe(false)
    // 電波が無い
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await youtubePlayable('a', offline)).toBe(false)
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
    expect(JSON.parse(String(calls[0].init?.body)).status.privacyStatus).toBe('unlisted')
    expect(calls[1].url).toBe('https://upload.example/session')
  })

  it('公開範囲は、撮るときに選んだものを設定より先に使う', async () => {
    const media = { id: 'm', recordId: 'r', skillId: 's', type: 'video/mp4', size: 1, createdAt: 0, updatedAt: 0 }
    expect((await videoMeta(media)).privacy).toBe('unlisted')
    await setYoutubePrivacy('public')
    expect((await videoMeta(media)).privacy).toBe('public')
    expect((await videoMeta({ ...media, youtubePrivacy: 'unlisted' })).privacy).toBe('unlisted')
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

describe('YouTube へのアップロード（アップロード先を読めないとき）', () => {
  it('1回で送る方式に切り替える', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url))
      return urls.length === 1 ? new Response(null, { status: 200 }) : Response.json({ id: 'xyz' })
    }) as unknown as typeof fetch
    expect(await uploadVideo(new Blob(['v'], { type: 'video/mp4' }), { title: 't', description: '' }, 'tk', fetchImpl)).toBe(
      'xyz',
    )
    expect(urls[1]).toMatch(/uploadType=multipart/)
  })
})

describe('レビュー2回目の修正', () => {
  it('別の端末の古い行で、YouTube に上げた結果を消さない（直した行を送り直す）', async () => {
    const domainId = await createDomain('ラテアート')
    await addRecord({
      skillId: await createSkill(domainId, input('ハート')),
      reason: '',
      nextAction: '',
      files: [new Blob(['v'], { type: 'video/mp4' })],
    })
    const [m] = await db.media.toArray()
    await db.media.update(m.id, { upload: 'done', youtubeId: 'yt1', updatedAt: m.updatedAt + 10 })
    await db.outbox.clear()
    await applyRemote([
      {
        kind: 'media',
        id: m.id,
        updatedAt: m.updatedAt + 20,
        deleted: false,
        data: { ...m, blob: undefined, upload: 'pending', keep: true },
      },
    ])
    const after = (await db.media.get(m.id))!
    expect(after).toMatchObject({ youtubeId: 'yt1', upload: 'done', keep: true })
    expect(await after.blob?.text()).toBe('v')
    expect(await db.outbox.get(['media', m.id])).toBeDefined()
  })

  it('同期している端末で復元したら、サーバーの内容を最初から受け取り直す', async () => {
    await createDomain('ピアノ')
    const parts = await exportBackup({ includeMedia: false })
    await db.meta.put({ key: 'sync:cursor', value: 42 })
    await importBackup(parts.map((p) => p.blob))
    expect((await db.meta.get('sync:cursor'))?.value).toBe(0)
  })

  it('音を録らないときは、音声コーデックを含まない形式を選ぶ', () => {
    const supported = (t: string) => t.startsWith('video/mp4')
    expect(pickRecorderMimeType(supported, false)).toBe('video/mp4;codecs=avc1.42E01E')
    expect(pickRecorderMimeType(supported, true)).toContain('mp4a')
  })
})

describe('中身を差し替えたときの同期', () => {
  it('ほかの端末で中身を差し替えたら、古い結果で上書きせず、端末の古い中身も捨てる', async () => {
    const domainId = await createDomain('ピアノ')
    const recordId = await addRecord({
      skillId: await createSkill(domainId, input('A')),
      reason: 'x',
      nextAction: '',
      files: [new Blob(['old'], { type: 'video/mp4' })],
    })
    const [m] = await db.media.where('recordId').equals(recordId).toArray()
    await db.media.update(m.id, { youtubeId: 'old', upload: 'done', cloudPoster: true, cloudPosterEnd: true })
    await db.outbox.clear()
    // ほかの端末で切り取った行（新しい中身、まだ上げていない）
    const replaced = {
      ...m,
      blob: undefined,
      contentAt: (m.contentAt ?? 0) + 10,
      size: 2,
      upload: 'pending',
      youtubeId: undefined,
      cloudPoster: false,
      cloudPosterEnd: false,
    }
    await applyRemote([{ kind: 'media', id: m.id, updatedAt: m.updatedAt + 10, deleted: false, data: replaced }])
    const after = await db.media.get(m.id)
    expect(after?.youtubeId).toBeUndefined()
    expect(after?.cloudPoster).toBe(false)
    expect(after?.blob).toBeUndefined()
    expect(await db.outbox.get(['media', m.id])).toBeUndefined()
  })

  it('端末で差し替えた中身は、差し替えを知らない端末の行で戻さない', async () => {
    const domainId = await createDomain('ピアノ')
    const recordId = await addRecord({
      skillId: await createSkill(domainId, input('A')),
      reason: 'x',
      nextAction: '',
      files: [new Blob(['new'], { type: 'video/mp4' })],
    })
    const [m] = await db.media.where('recordId').equals(recordId).toArray()
    await db.outbox.clear()
    // 差し替えを知らない端末が、残す印だけ変えた古い中身の行
    const stale = {
      ...m,
      blob: undefined,
      contentAt: (m.contentAt ?? 0) - 10,
      size: 99,
      youtubeId: 'old',
      upload: 'done',
      keep: true,
    }
    await applyRemote([{ kind: 'media', id: m.id, updatedAt: m.updatedAt + 10, deleted: false, data: stale }])
    const after = await db.media.get(m.id)
    expect(after?.keep).toBe(true)
    expect(after?.size).toBe(m.size)
    expect(after?.youtubeId).toBeUndefined()
    expect(await after?.blob?.text()).toBe('new')
    expect(await db.outbox.get(['media', m.id])).toBeDefined()
  })
})

describe('アプリのファイルにある中身の同期', () => {
  it('サーバーから同じ中身の行が来ても、アプリのファイルの場所は残す（消されないように）', async () => {
    const m = {
      id: 'm1',
      recordId: 'r1',
      skillId: 's1',
      type: 'video/mp4',
      size: 1,
      createdAt: 1,
      updatedAt: 1,
      contentAt: 1,
      file: 'media/m1-1.mp4',
    }
    await db.media.add(m)
    const { file: _file, ...remote } = m
    await applyRemote([{ kind: 'media', id: m.id, updatedAt: 5, deleted: false, data: { ...remote, upload: 'done', youtubeId: 'yt' } }])
    expect(await db.media.get(m.id)).toMatchObject({ file: 'media/m1-1.mp4', youtubeId: 'yt' })
  })
})

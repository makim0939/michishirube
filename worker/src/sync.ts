import {
  isEntityKind,
  SYNC_LIMITS,
  type EntityChange,
  type SyncRequest,
  type SyncResponse,
} from '../../shared/protocol'

export class BadRequest extends Error {}

/** 送られてきた変更を検査する。形が崩れていたら全体を断る（一部だけ反映されるのを避ける） */
export function parseSyncRequest(body: unknown): SyncRequest {
  if (typeof body !== 'object' || body === null) throw new BadRequest('body must be an object')
  const { since, changes } = body as Record<string, unknown>
  if (typeof since !== 'number' || !Number.isInteger(since) || since < 0) throw new BadRequest('since must be >= 0')
  if (!Array.isArray(changes)) throw new BadRequest('changes must be an array')
  if (changes.length > SYNC_LIMITS.maxChanges) throw new BadRequest(`too many changes (max ${SYNC_LIMITS.maxChanges})`)
  return {
    since,
    changes: changes.map((c, i): EntityChange => {
      if (typeof c !== 'object' || c === null) throw new BadRequest(`changes[${i}] must be an object`)
      const { kind, id, updatedAt, deleted, data } = c as Record<string, unknown>
      if (!isEntityKind(kind)) throw new BadRequest(`changes[${i}].kind is invalid`)
      if (typeof id !== 'string' || id.length === 0 || id.length > 100) throw new BadRequest(`changes[${i}].id is invalid`)
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) {
        throw new BadRequest(`changes[${i}].updatedAt is invalid`)
      }
      if (typeof deleted !== 'boolean') throw new BadRequest(`changes[${i}].deleted must be boolean`)
      if (!deleted) {
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          throw new BadRequest(`changes[${i}].data must be an object`)
        }
        if (JSON.stringify(data).length > SYNC_LIMITS.maxEntityBytes) throw new BadRequest(`changes[${i}] is too large`)
      }
      return { kind, id, updatedAt, deleted, data: deleted ? null : (data as Record<string, unknown>) }
    }),
  }
}

interface Row {
  kind: string
  id: string
  data: string | null
  updated_at: number
  deleted: number
  seq: number
}

/**
 * 変更を書き込み、since より後の変更を返す。
 * 同じものが両方の端末で変わっていたら、updatedAt が新しいほうを残す（同じ時刻なら先に届いたほう）
 */
export async function sync(db: D1Database, req: SyncRequest): Promise<SyncResponse> {
  if (req.changes.length > 0) {
    const upsert = db.prepare(
      `INSERT INTO entities (kind, id, data, updated_at, deleted, seq)
       VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM entities))
       ON CONFLICT (kind, id) DO UPDATE SET
         data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq
       WHERE excluded.updated_at > entities.updated_at`,
    )
    const removePhoto = db.prepare('DELETE FROM photos WHERE id = ?1')
    const statements = req.changes.flatMap((c) => {
      const s = [upsert.bind(c.kind, c.id, c.deleted ? null : JSON.stringify(c.data), c.updatedAt, c.deleted ? 1 : 0)]
      // メディアを消したら、サーバーに置いた写真も消す
      if (c.kind === 'media' && c.deleted) s.push(removePhoto.bind(c.id))
      return s
    })
    // batch は1つのトランザクションとして順に実行される
    await db.batch(statements)
  }

  const { results } = await db
    .prepare('SELECT kind, id, data, updated_at, deleted, seq FROM entities WHERE seq > ?1 ORDER BY seq LIMIT ?2')
    .bind(req.since, SYNC_LIMITS.pageSize + 1)
    .all<Row>()
  const page = results.slice(0, SYNC_LIMITS.pageSize)
  return {
    cursor: page.length > 0 ? page[page.length - 1].seq : req.since,
    more: results.length > SYNC_LIMITS.pageSize,
    changes: page.map((r) => ({
      kind: r.kind as EntityChange['kind'],
      id: r.id,
      updatedAt: r.updated_at,
      deleted: r.deleted === 1,
      data: r.data === null ? null : (JSON.parse(r.data) as Record<string, unknown>),
    })),
  }
}

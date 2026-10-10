import Dexie, { type EntityTable, type Transaction } from 'dexie'
import type { EntityKind } from '../../shared/protocol'
import type { Domain, Media, PracticeRecord, Skill } from '../domain/types'

export interface Meta {
  key: string
  value: unknown
}

/** サーバーへ送っていない変更。消したものも、ここに残っていれば削除として送る */
export interface OutboxEntry {
  kind: EntityKind
  id: string
  at: number
}

export class AppDB extends Dexie {
  domains!: EntityTable<Domain, 'id'>
  skills!: EntityTable<Skill, 'id'>
  records!: EntityTable<PracticeRecord, 'id'>
  media!: EntityTable<Media, 'id'>
  meta!: EntityTable<Meta, 'key'>
  outbox!: Dexie.Table<OutboxEntry, [EntityKind, string]>

  constructor(name = 'michishirube') {
    super(name)
    this.version(1).stores({
      domains: 'id, order',
      skills: 'id, domainId, status',
      records: 'id, skillId, createdAt, [skillId+createdAt]',
      media: 'id, recordId, skillId, createdAt',
      meta: 'key',
    })
    this.version(2)
      .stores({
        media: 'id, recordId, skillId, createdAt, upload',
        outbox: '[kind+id]',
      })
      .upgrade(upgradeToV2)
  }
}

/** 同期と参考資料のための項目を、既存のデータに足す */
async function upgradeToV2(tx: Transaction) {
  const stamp = (row: { createdAt: number; updatedAt?: number }) => {
    row.updatedAt ??= row.createdAt
  }
  await tx.table('domains').toCollection().modify(stamp)
  await tx.table('records').toCollection().modify(stamp)
  await tx
    .table('skills')
    .toCollection()
    .modify((s: Skill) => {
      stamp(s)
      s.references ??= []
    })
  await tx
    .table('media')
    .toCollection()
    .modify((m: Media) => {
      stamp(m)
      // 既存の動画も、YouTube と連携したら上げる
      if (m.type.startsWith('video/') && !m.upload) m.upload = 'pending'
    })
}

export let db = new AppDB()

/** テスト用：毎回まっさらな DB に差し替える */
export function useDatabase(next: AppDB) {
  db = next
}

export function newId(): string {
  // crypto.randomUUID は https / localhost でしか使えないので、LAN の http で開いたとき用の代替を持つ
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 変更をサーバーへ送る印を付ける。書き込みと同じトランザクションの中で呼ぶ */
export async function markDirty(kind: EntityKind, ids: string[]) {
  if (ids.length === 0) return
  const at = Date.now()
  await db.outbox.bulkPut(ids.map((id) => ({ kind, id, at })))
}

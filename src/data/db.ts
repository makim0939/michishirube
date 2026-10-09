import Dexie, { type EntityTable } from 'dexie'
import type { Domain, Media, PracticeRecord, Skill } from '../domain/types'

export interface Meta {
  key: string
  value: unknown
}

export class AppDB extends Dexie {
  domains!: EntityTable<Domain, 'id'>
  skills!: EntityTable<Skill, 'id'>
  records!: EntityTable<PracticeRecord, 'id'>
  media!: EntityTable<Media, 'id'>
  meta!: EntityTable<Meta, 'key'>

  constructor(name = 'michishirube') {
    super(name)
    this.version(1).stores({
      domains: 'id, order',
      skills: 'id, domainId, status',
      records: 'id, skillId, createdAt, [skillId+createdAt]',
      media: 'id, recordId, skillId, createdAt',
      meta: 'key',
    })
  }
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

// 言語を決めるのは、文言（i18n）を読み込むより先（import は書いた順に読まれる）
import './test-lang'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach } from 'vitest'
import { AppDB, db, useDatabase } from './data/db'

let counter = 0

beforeEach(() => {
  counter += 1
  useDatabase(new AppDB(`test-${counter}`))
})

afterEach(async () => {
  await db.delete()
})

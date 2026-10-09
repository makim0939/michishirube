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

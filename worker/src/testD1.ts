/**
 * テストで使う D1 の代わり。Node の SQLite（node:sqlite）の上に、Worker が使う分の D1 の形（prepare・bind・first・all・run・batch）だけを作る。
 * SQL の挙動（ON CONFLICT・条件付きの INSERT・batch のトランザクション）を、本物と同じ SQLite で確かめるため
 * （モックだと、SQL の書き間違いを見逃す）。マイグレーションをすべて当てた状態から始める
 */

// worker の型（workers-types）には Node の型が無いので、使う分だけ書く
interface SqliteStatement {
  columns(): unknown[]
  all(...params: unknown[]): Record<string, unknown>[]
  get(...params: unknown[]): Record<string, unknown> | undefined
  run(...params: unknown[]): { changes: number | bigint }
}
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}

/** D1 と同じく、ArrayBuffer は BLOB として渡す（node:sqlite は ArrayBuffer をそのまま受け取らない） */
function toSqlite(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (value === undefined) return null
  return value
}

class Statement {
  constructor(
    readonly db: SqliteDb,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map(toSqlite))
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) ?? null) as T | null
  }
  async all<T>() {
    return this.exec<T>()
  }
  async run() {
    return this.exec()
  }
  /** 結果の列がある文（SELECT・RETURNING）か、書き込みだけの文かで、node:sqlite の呼び方を分ける */
  exec<T>() {
    const stmt = this.db.prepare(this.sql)
    if (stmt.columns().length > 0) {
      return { results: stmt.all(...this.params) as T[], meta: { changes: 0 } }
    }
    const { changes } = stmt.run(...this.params)
    return { results: [] as T[], meta: { changes: Number(changes) } }
  }
}

export async function testD1(): Promise<D1Database> {
  // 文字列で渡して、Vite・型チェックに Node の組み込みとして解決させない（Node の型を worker に入れないため）
  const sqlite = (await import(/* @vite-ignore */ 'node:sqlite' as string)) as { DatabaseSync: new (path: string) => SqliteDb }
  const db = new sqlite.DatabaseSync(':memory:')
  const { readdir, readFile } = (await import(/* @vite-ignore */ 'node:fs/promises' as string)) as {
    readdir(path: string): Promise<string[]>
    readFile(path: string, encoding: 'utf8'): Promise<string>
  }
  // pathname のままだと、空白・日本語を含むパスが %XX のまま残るので、戻す
  const dir = decodeURIComponent(new URL('../migrations/', (import.meta as unknown as { url: string }).url).pathname)
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) db.exec(await readFile(dir + name, 'utf8'))
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    // D1 の batch は1つのトランザクション。途中で失敗したら、全部を戻す
    async batch(statements: Statement[]) {
      db.exec('BEGIN')
      try {
        const out = statements.map((s) => s.exec())
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
  return d1 as unknown as D1Database
}

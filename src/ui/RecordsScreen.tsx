import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../data/db'
import type { Media } from '../domain/types'
import { formatAgo } from './common'
import { RecordCard } from './RecordCard'
import { href } from './router'

/** 動画を一度に読み込みすぎないよう、少しずつ出す */
const PAGE = 15

/** 「記録」タブ：全部のスキルの記録を新しい順に。日付ごとに区切る */
export function RecordsScreen() {
  const [limit, setLimit] = useState(PAGE)
  const [skillFilter, setSkillFilter] = useState<string>('')

  const data = useLiveQuery(async () => {
    const [skills, domains, total] = await Promise.all([
      db.skills.toArray(),
      db.domains.toArray(),
      db.records.orderBy('createdAt').count(),
    ])
    const query = skillFilter
      ? db.records.where('[skillId+createdAt]').between([skillFilter, -Infinity], [skillFilter, Infinity]).reverse()
      : db.records.orderBy('createdAt').reverse()
    const records = await query.limit(limit + 1).toArray()
    const mediaIds = records.slice(0, limit).flatMap((r) => r.mediaIds ?? [])
    const media = (await db.media.bulkGet(mediaIds)).filter((m): m is Media => !!m)
    // 記録のある型だけを絞り込みの候補にする。
    // iPhone の Safari は、記録が0件のときに重複なしのカーソル（uniqueKeys）を開けずに落ちるので、キーを全部読んでまとめる
    const recorded = new Set((await db.records.orderBy('skillId').keys()) as string[])
    return { skills, domains, records, media, total, recorded }
  }, [limit, skillFilter])

  if (!data) return null
  const skillById = new Map(data.skills.map((s) => [s.id, s]))
  const domainName = new Map(data.domains.map((d) => [d.id, d.name]))
  const mediaById = new Map(data.media.map((m) => [m.id, m]))
  const shown = data.records.slice(0, limit)
  const more = data.records.length > limit

  // 日付の見出しで区切る
  const groups: { label: string; items: typeof shown }[] = []
  for (const r of shown) {
    const label = formatAgo(r.createdAt)
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(r)
    else groups.push({ label, items: [r] })
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>カップ帳</h1>
        <span className="pill">{data.total} 件</span>
      </header>

      {data.recorded.size > 1 && (
        <label className="field">
          <span className="sr-only">型で絞り込む</span>
          <select value={skillFilter} onChange={(e) => {
            setSkillFilter(e.target.value)
            setLimit(PAGE)
          }}>
            <option value="">すべての型</option>
            {data.skills
              .filter((s) => data.recorded.has(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {domainName.get(s.domainId)}・{s.name}
                </option>
              ))}
          </select>
        </label>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          <p>まだ記録がありません。</p>
          <a className="btn primary" href={href('/')}>
            今日の練習へ
          </a>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="section">
            <h2>{g.label}</h2>
            <ul className="records">
              {g.items.map((r) => {
                const skill = skillById.get(r.skillId)
                return (
                  <RecordCard
                    key={r.id}
                    record={r}
                    media={(r.mediaIds ?? []).map((id) => mediaById.get(id)).filter((m): m is Media => !!m)}
                    skill={skill}
                    domainName={skill && domainName.get(skill.domainId)}
                  />
                )
              })}
            </ul>
          </section>
        ))
      )}

      {more && (
        <button className="btn" onClick={() => setLimit((n) => n + PAGE)}>
          さらに表示
        </button>
      )}
    </div>
  )
}

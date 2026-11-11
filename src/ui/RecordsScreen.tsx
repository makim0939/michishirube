import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../data/db'
import { cupNumbers, recordedSkillIds } from '../data/repo'
import { getVideoStorage } from '../data/videoStorage'
import type { Media } from '../domain/types'
import { formatAgo, splitName } from './common'
import { type Cup, CupGrid } from './CupGrid'
import { pickCupMedia } from './cupImage'
import { href } from './router'
import { readStorage, writeStorage } from './storage'
import { t } from '../i18n'

/** 一度にたくさん読み込みすぎないよう、少しずつ出す（3列なので3の倍数） */
const PAGE = 24

const LAYOUT_KEY = 'michishirube:records-layout'
type Layout = 'days' | 'tiles'

/** ラテ帳：全部の型の杯を新しい順に、写真の格子で。日付ごとに区切る表示と、区切らずに並べる表示を選べて、押すとその1杯の詳細を開く */
export function RecordsScreen() {
  const [limit, setLimit] = useState(PAGE)
  const [skillFilter, setSkillFilter] = useState<string>('')
  // 日付ごとに分ける表示が初め。並べ方は、次に開いたときも覚えておく
  const [layout, setLayout] = useState<Layout>(() => (readStorage('local', LAYOUT_KEY) === 'tiles' ? 'tiles' : 'days'))
  const changeLayout = (l: Layout) => {
    setLayout(l)
    writeStorage('local', LAYOUT_KEY, l)
  }

  const data = useLiveQuery(async () => {
    const [skills, domains, all] = await Promise.all([
      db.skills.toArray(),
      db.domains.toArray(),
      db.records.orderBy('createdAt').count(),
    ])
    // 型で絞り込んでいるときは、その型の杯数（見出しの数が、並んでいる杯と合うように）
    const total = skillFilter ? await db.records.where('skillId').equals(skillFilter).count() : all
    const query = skillFilter
      ? db.records.where('[skillId+createdAt]').between([skillFilter, -Infinity], [skillFilter, Infinity]).reverse()
      : db.records.orderBy('createdAt').reverse()
    const records = await query.limit(limit + 1).toArray()
    const mediaIds = records.slice(0, limit).flatMap((r) => r.mediaIds ?? [])
    const media = (await db.media.bulkGet(mediaIds)).filter((m): m is Media => !!m)
    // 記録のある型だけを絞り込みの候補にする
    const recorded = await recordedSkillIds()
    const numbers = await cupNumbers(records.slice(0, limit))
    // アップの失敗は、保存先が YouTube のときだけ知らせる
    const uploads = (await getVideoStorage()) === 'youtube'
    return { skills, domains, records, media, total, recorded, numbers, uploads }
  }, [limit, skillFilter])

  if (!data) return null
  const skillById = new Map(data.skills.map((s) => [s.id, s]))
  const domainName = new Map(data.domains.map((d) => [d.id, d.name]))
  // 分野が1つなら、型の名前だけで分かる
  const manyDomains = data.domains.length > 1
  const mediaById = new Map(data.media.map((m) => [m.id, m]))
  const shown = data.records.slice(0, limit)
  const more = data.records.length > limit

  // 日付の見出しで区切る
  const groups: { label: string; cups: Cup[] }[] = []
  for (const r of shown) {
    const label = formatAgo(r.createdAt)
    const cup: Cup = {
      record: r,
      media: pickCupMedia((r.mediaIds ?? []).map((id) => mediaById.get(id))),
      number: data.numbers.get(r.id) ?? 0,
      skillName: skillById.get(r.skillId)?.name,
      failed: data.uploads && (r.mediaIds ?? []).some((id) => mediaById.get(id)?.upload === 'failed'),
    }
    if (groups.at(-1)?.label === label) groups.at(-1)!.cups.push(cup)
    else groups.push({ label, cups: [cup] })
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>{t.app.tabRecords}</h1>
        <span className="pill">{t.common.cups(data.total)}</span>
      </header>

      {data.recorded.size > 1 && (
        <label className="field">
          <span className="sr-only">{t.records.filter}</span>
          <select value={skillFilter} onChange={(e) => {
            setSkillFilter(e.target.value)
            setLimit(PAGE)
          }}>
            <option value="">{t.records.all}</option>
            {data.skills
              .filter((s) => data.recorded.has(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {manyDomains ? `${domainName.get(s.domainId)}${t.common.sep}` : ''}
                  {splitName(s.name).main}
                </option>
              ))}
          </select>
        </label>
      )}

      {shown.length > 0 && (
        <div className="segmented small view-switch" role="group" aria-label={t.records.layout}>
          <button
            type="button"
            className={layout === 'days' ? 'selected' : ''}
            aria-pressed={layout === 'days'}
            onClick={() => changeLayout('days')}
          >
            {t.records.byDay}
          </button>
          <button
            type="button"
            className={layout === 'tiles' ? 'selected' : ''}
            aria-pressed={layout === 'tiles'}
            onClick={() => changeLayout('tiles')}
          >
            {t.records.tiles}
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          <p>{t.common.noRecordsYet}</p>
          <a className="btn primary" href={href('/')}>
            {t.records.toToday}
          </a>
        </div>
      ) : layout === 'tiles' ? (
        // 日付で区切らず、新しい順にそのまま並べる
        <CupGrid cups={groups.flatMap((g) => g.cups)} />
      ) : (
        groups.map((g) => (
          <section key={g.label} className="section">
            <h2>{g.label}</h2>
            <CupGrid cups={g.cups} />
          </section>
        ))
      )}

      {more && (
        <button className="btn" onClick={() => setLimit((n) => n + PAGE)}>
          {t.records.more}
        </button>
      )}
    </div>
  )
}

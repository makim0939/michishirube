import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import { cupNumbers } from '../data/repo'
import { OUTCOME_LABEL } from '../domain/format'
import type { Media } from '../domain/types'
import { Empty, formatDate, splitName } from './common'
import { BackIcon } from './icons'
import { MediaItem } from './MediaItem'
import { PatternImage } from './PatternImage'
import { backHandler, href } from './router'

/** 1杯（記録1件）の詳細。今日の「最近の杯」から開き、動画・写真と理由・次の一手を見返す */
export function CupScreen({ recordId }: { recordId: string }) {
  const data = useLiveQuery(async () => {
    const record = await db.records.get(recordId)
    if (!record) return { record }
    const [skill, media, numbers] = await Promise.all([
      db.skills.get(record.skillId),
      db.media.bulkGet(record.mediaIds ?? []),
      cupNumbers([record]),
    ])
    // 型に関係なく、全部の記録の通し番号
    const number = numbers.get(record.id) ?? 0
    return { record, skill, media: media.filter((m): m is Media => !!m), number }
  }, [recordId])

  if (!data) return null
  const { record } = data
  if (!record) return <Empty>この記録は見つかりません。</Empty>
  const { skill, media, number } = data
  const name = skill ? splitName(skill.name).main : ''

  return (
    <div className="screen cup">
      <header className="screen-header">
        <a className="back" href={href('/')} onClick={backHandler('/')} aria-label="戻る">
          <BackIcon size={26} />
        </a>
        <span className="title-block muted small">{formatDate(record.createdAt)}</span>
        <a className="btn small ghost" href={href(`/record/${record.skillId}/edit/${record.id}`)}>
          直す
        </a>
      </header>

      <div className="cup-head">
        {skill && <PatternImage name={skill.name} />}
        <div>
          <h1>{name}</h1>
          <p className="muted small">
            No.{number}
            {record.outcome && (
              <span className={`outcome outcome-${record.outcome}`}>　{OUTCOME_LABEL[record.outcome]}</span>
            )}
          </p>
        </div>
      </div>

      {media.length > 0 ? (
        <div className="cup-media">
          {media.map((m, i) => (
            <MediaItem key={m.id} media={m} autoLoad={i === 0} />
          ))}
        </div>
      ) : (
        <p className="muted">動画・写真はありません。</p>
      )}

      <section className="cup-notes">
        <div>
          <h2>なぜそうなった？</h2>
          {(record.causes?.length ?? 0) > 0 && (
            <ul className="cause-tags">
              {record.causes!.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          {(record.reason || !record.causes?.length) && (
            <p className={record.reason ? '' : 'muted'}>{record.reason || 'まだ書いていません'}</p>
          )}
        </div>
        <div>
          <h2>次の一手</h2>
          <p className={record.nextAction ? '' : 'muted'}>{record.nextAction || 'まだ書いていません'}</p>
        </div>
      </section>

      {skill && (
        <a className="sub-link" href={href(`/skill/${skill.id}`)}>
          「{name}」の記録と合格の目安を見る
        </a>
      )}
    </div>
  )
}

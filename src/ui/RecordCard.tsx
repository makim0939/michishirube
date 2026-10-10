import type { Media, PracticeRecord, Skill } from '../domain/types'
import { formatDate, splitName } from './common'
import { MediaItem } from './MediaItem'
import { href } from './router'

const OUTCOME_LABEL = { good: '◎ 成功', meh: '△ 惜しい', bad: '✕ 失敗' } as const

/** 記録1件。スキル画面と「記録」タブで使う。直す・消すは編集画面から */
export function RecordCard({
  record,
  media,
  skill,
  domainName,
}: {
  record: PracticeRecord
  media: Media[]
  /** 「記録」タブでは、どのスキルの記録かも出す */
  skill?: Skill
  domainName?: string
}) {
  return (
    <li className="record">
      <div className="record-head">
        <span className="muted">{formatDate(record.createdAt)}</span>
        {record.outcome && <span className={`outcome outcome-${record.outcome}`}>{OUTCOME_LABEL[record.outcome]}</span>}
      </div>
      {skill && (
        <a className="record-skill" href={href(`/skill/${skill.id}`)}>
          {domainName && <span className="muted">{domainName}・</span>}
          {splitName(skill.name).main}
        </a>
      )}
      {media.length > 0 && (
        <div className="record-media">
          {media.map((m) => (
            <MediaItem key={m.id} media={m} />
          ))}
        </div>
      )}
      {record.reason && (
        <p>
          <span className="label">理由</span>
          {record.reason}
        </p>
      )}
      {record.nextAction && (
        <p>
          <span className="label">次の一手</span>
          {record.nextAction}
        </p>
      )}
      <a className="btn small ghost record-edit" href={href(`/record/${record.skillId}/edit/${record.id}`)}>
        直す
      </a>
    </li>
  )
}

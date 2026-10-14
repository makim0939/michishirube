import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { db } from '../data/db'
import { OUTCOME_LABEL } from '../domain/format'
import type { Media } from '../domain/types'
import { formatDate, splitName } from './common'
import { BackIcon, ForwardIcon } from './icons'
import { MediaItem } from './MediaItem'
import { PatternImage } from './PatternImage'
import { backHandler, goBack, href, replace } from './router'

/** 1杯（記録1件）の詳細。今日の「最近の杯」から開き、動画・写真と理由・次の一手を見返す */
export function CupScreen({ recordId }: { recordId: string }) {
  const data = useLiveQuery(async () => {
    const record = await db.records.get(recordId)
    if (!record) return { record }
    const [skill, media, order] = await Promise.all([
      db.skills.get(record.skillId),
      db.media.bulkGet(record.mediaIds ?? []),
      // 杯の通し番号と同じ並び（日時の順）で、前後の杯をたどる
      db.records.orderBy('createdAt').primaryKeys() as Promise<string[]>,
    ])
    const index = order.indexOf(record.id)
    return {
      record,
      skill,
      media: media.filter((m): m is Media => !!m),
      // 型に関係なく、全部の記録の通し番号
      number: index + 1,
      prevId: index > 0 ? order[index - 1] : undefined,
      nextId: index >= 0 && index < order.length - 1 ? order[index + 1] : undefined,
    }
  }, [recordId])

  // 編集で削除したあと・別の端末で消されたときは、無くなった杯の画面に留まらず、来た画面へ戻る
  const missing = !!data && !data.record
  useEffect(() => {
    if (missing) goBack('/')
  }, [missing])

  if (!data?.record) return null
  const { record } = data
  const { skill, media, number, prevId, nextId } = data
  const name = skill ? splitName(skill.name).main : ''

  return (
    <div className="screen cup">
      <header className="screen-header">
        <a className="back" href={href('/')} onClick={backHandler('/')} aria-label="戻る">
          <BackIcon size={26} />
        </a>
        <span className="title-block muted small">{formatDate(record.createdAt)}</span>
        <a className="btn small ghost" href={href(`/record/${record.skillId}/edit/${record.id}`)}>
          編集
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

      {/* 書いたものだけを出す（メモは書きたいときだけ書くので、無くても「まだ」とは言わない） */}
      {((record.causes?.length ?? 0) > 0 || record.reason || record.nextAction) && (
        <section className="cup-notes">
          {(record.causes?.length ?? 0) > 0 && (
            <div>
              <h2>原因</h2>
              <ul className="cause-tags">
                {record.causes!.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {record.reason && (
            <div>
              <h2>メモ</h2>
              <p>{record.reason}</p>
            </div>
          )}
          {record.nextAction && (
            <div>
              <h2>次の一手</h2>
              <p>{record.nextAction}</p>
            </div>
          )}
        </section>
      )}

      {/* 前後の杯へ（戻るで何杯もさかのぼらないよう、履歴は積まない） */}
      <nav className="cup-nav" aria-label="前後の杯">
        {prevId ? (
          <button type="button" className="btn small cup-nav-button" onClick={() => replace(`/cup/${prevId}`)}>
            <BackIcon size={18} />
            No.{number - 1}
          </button>
        ) : (
          <span />
        )}
        {nextId ? (
          <button type="button" className="btn small cup-nav-button" onClick={() => replace(`/cup/${nextId}`)}>
            No.{number + 1}
            <ForwardIcon size={18} />
          </button>
        ) : (
          <span />
        )}
      </nav>

      {skill && (
        <a className="sub-link" href={href(`/skill/${skill.id}`)}>
          「{name}」の記録とコツを見る
        </a>
      )}
    </div>
  )
}

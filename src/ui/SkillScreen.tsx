import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db } from '../data/db'
import {
  achieveSkill,
  activateSkill,
  deactivateSkill,
  deleteRecord,
  getSettings,
  recordsOf,
  revertAchievement,
} from '../data/repo'
import { canActivate, computeStates, indexById } from '../domain/logic'
import { isWebUrl } from '../domain/template'
import type { Media, PracticeRecord } from '../domain/types'
import { ConfirmButton, Empty, formatDate, isVideo, MediaView, StateBadge, STATE_ICON } from './common'
import { useAction, useCelebrate, useToast } from './feedback'
import { backHandler, href } from './router'

/** 動画をまとめて読み込むと重いので、記録は少しずつ出す */
const RECORDS_PAGE = 10

const OUTCOME_LABEL = { good: '◎ 成功', meh: '△ 惜しい', bad: '✕ 失敗' } as const

/** 最初と最新を並べて、上達を目で見られるようにする */
function Compare({ media }: { media: Media[] }) {
  const hasVideo = media.some(isVideo)
  const hasImage = media.some((m) => !isVideo(m))
  const [kind, setKind] = useState<'video' | 'image'>(hasVideo ? 'video' : 'image')
  const videos = useRef<(HTMLVideoElement | null)[]>([])
  const list = media.filter((m) => (kind === 'video' ? isVideo(m) : !isVideo(m)))
  if (list.length < 2) return null
  const first = list[0]
  const latest = list[list.length - 1]

  return (
    <section className="section">
      <div className="section-head">
        <h2>最初と最新</h2>
        {hasVideo && hasImage && (
          <div className="segmented small">
            <button className={kind === 'video' ? 'selected' : ''} onClick={() => setKind('video')}>
              動画
            </button>
            <button className={kind === 'image' ? 'selected' : ''} onClick={() => setKind('image')}>
              写真
            </button>
          </div>
        )}
      </div>
      <div className="compare">
        {[first, latest].map((m, i) => (
          <figure key={m.id}>
            <MediaView blob={m.blob} type={m.type} videoRef={(el) => (videos.current[i] = el)} />
            <figcaption>
              {i === 0 ? '最初' : '最新'}・{formatDate(m.createdAt)}
            </figcaption>
          </figure>
        ))}
      </div>
      {kind === 'video' && (
        <button
          className="btn small"
          onClick={() => {
            for (const v of videos.current) {
              if (!v) continue
              v.currentTime = 0
              v.play().catch(() => {
                // 自動再生が止められた場合は、各動画の再生ボタンで再生してもらう
              })
            }
          }}
        >
          ▶ 同時に再生
        </button>
      )}
    </section>
  )
}

function RecordItem({ record, media }: { record: PracticeRecord; media: Media[] }) {
  const run = useAction()
  return (
    <li className="record">
      <div className="record-head">
        <span className="muted">{formatDate(record.createdAt)}</span>
        {record.outcome && <span className={`outcome outcome-${record.outcome}`}>{OUTCOME_LABEL[record.outcome]}</span>}
      </div>
      {media.length > 0 && (
        <div className="record-media">
          {media.map((m) => (
            <MediaView key={m.id} blob={m.blob} type={m.type} />
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
      <ConfirmButton
        className="btn small ghost"
        confirmLabel="削除する"
        message="この記録と動画・写真を削除します。元に戻せません。"
        onConfirm={() => run(() => deleteRecord(record.id))}
      >
        削除
      </ConfirmButton>
    </li>
  )
}

export function SkillScreen({ id }: { id: string }) {
  const run = useAction()
  const toast = useToast()
  const celebrate = useCelebrate()
  const [askingAchieve, setAskingAchieve] = useState(false)
  const [shown, setShown] = useState(RECORDS_PAGE)

  const data = useLiveQuery(async () => {
    const skill = await db.skills.get(id)
    if (!skill) return { skill: undefined }
    const [skills, domain, records, media, settings] = await Promise.all([
      db.skills.where('domainId').equals(skill.domainId).toArray(),
      db.domains.get(skill.domainId),
      recordsOf(id),
      db.media.where('skillId').equals(id).sortBy('createdAt'),
      getSettings(),
    ])
    // 上限は全分野の合計なので、挑戦できるかは全スキルで判定する
    const allSkills = await db.skills.toArray()
    return { skill, skills, domain, records, media, settings, allSkills }
  }, [id])

  if (!data) return null
  if (!data.skill) return <Empty>スキルが見つかりません。</Empty>
  const { skill, skills, domain, records, media, settings, allSkills } = data
  const states = computeStates(skills)
  const state = states.get(skill.id)!
  const byId = indexById(skills)
  const prereqs = skill.prereqIds.map((p) => byId.get(p)).filter((s) => !!s)
  const leadsTo = skills.filter((s) => s.prereqIds.includes(skill.id))
  const check = canActivate(skill, allSkills, settings.maxActive)
  const mediaById = new Map(media.map((m) => [m.id, m]))

  return (
    <div className="screen">
      <header className="screen-header">
        <a
          className="back"
          href={href(`/map/${skill.domainId}`)}
          onClick={backHandler(`/map/${skill.domainId}`)}
          aria-label="戻る"
        >
          ←
        </a>
        <div className="title-block">
          <span className="muted">{domain?.name}</span>
          <h1>{skill.name}</h1>
        </div>
        <a className="btn small ghost" href={href(`/skill/${skill.id}/edit`)}>
          編集
        </a>
      </header>

      <div className="row wrap">
        <StateBadge state={state} />
        {skill.achievedAt && <span className="muted">{formatDate(skill.achievedAt)} に達成</span>}
      </div>

      <section className="criteria-box">
        <h2>達成条件</h2>
        <p>{skill.criteria || '（未設定）編集から、判定できる条件を書いてください'}</p>
      </section>

      <div className="actions">
        {state === 'active' && (
          <a className="btn primary" href={href(`/record/${skill.id}`)}>
            記録する
          </a>
        )}
        {state === 'available' && (
          <button
            className="btn primary"
            disabled={!check.ok}
            onClick={() =>
              run(async () => {
                await activateSkill(skill.id)
                toast.show(`「${skill.name}」に挑戦します`)
              })
            }
          >
            挑戦する
          </button>
        )}
        {(state === 'active' || state === 'available') && !askingAchieve && (
          <button className="btn achieve" onClick={() => setAskingAchieve(true)}>
            🏆 達成した
          </button>
        )}
        {state === 'active' && (
          <button className="btn ghost" onClick={() => run(() => deactivateSkill(skill.id))}>
            挑戦をやめる
          </button>
        )}
        {state === 'done' && (
          <ConfirmButton
            className="btn ghost"
            confirmLabel="取り消す"
            message="達成を取り消します。このスキルを前提にしている挑戦中のスキルは、挑戦中から外れます。"
            onConfirm={() => run(() => revertAchievement(skill.id))}
          >
            達成を取り消す
          </ConfirmButton>
        )}
      </div>
      {state === 'available' && !check.ok && check.reason === 'limit' && (
        <p className="muted">挑戦中は {settings.maxActive} つまでです。いまのスキルを達成するか、挑戦をやめると選べます。</p>
      )}

      {askingAchieve && (
        <div className="confirm achieve-confirm">
          <p>
            <strong>達成条件を満たしましたか？</strong>
          </p>
          <p>{skill.criteria || '（達成条件が未設定です）'}</p>
          <div className="row">
            <button
              className="btn achieve"
              onClick={() =>
                run(async () => {
                  const result = await achieveSkill(skill.id)
                  setAskingAchieve(false)
                  celebrate(result)
                })
              }
            >
              はい、達成
            </button>
            <button className="btn" onClick={() => setAskingAchieve(false)}>
              まだ
            </button>
          </div>
        </div>
      )}

      {state === 'locked' && (
        <section className="section">
          <h2>先に達成するスキル</h2>
          <ul className="chips">
            {prereqs
              .filter((p) => p.status !== 'done')
              .map((p) => (
                <li key={p.id}>
                  <a href={href(`/skill/${p.id}`)}>{p.name}</a>
                </li>
              ))}
          </ul>
        </section>
      )}

      <Compare media={media} />

      {skill.description && (
        <section className="section">
          <h2>説明・やり方</h2>
          <p className="prewrap">{skill.description}</p>
        </section>
      )}

      {skill.sources.length > 0 && (
        <section className="section">
          <h2>出典</h2>
          <ul className="sources">
            {skill.sources.map((s, i) => (
              <li key={i}>
                {s.url && isWebUrl(s.url) ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(prereqs.length > 0 || leadsTo.length > 0) && (
        <section className="section">
          {prereqs.length > 0 && (
            <>
              <h2>前提</h2>
              <ul className="chips">
                {prereqs.map((p) => (
                  <li key={p.id}>
                    <a href={href(`/skill/${p.id}`)}>
                      {STATE_ICON[states.get(p.id)!]} {p.name}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {leadsTo.length > 0 && (
            <>
              <h2>達成すると進める先</h2>
              <ul className="chips">
                {leadsTo.map((s) => (
                  <li key={s.id}>
                    <a href={href(`/skill/${s.id}`)}>
                      {STATE_ICON[states.get(s.id)!]} {s.name}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="section">
        <h2>記録（{records.length}）</h2>
        {records.length === 0 ? (
          <p className="muted">まだ記録がありません。</p>
        ) : (
          <ul className="records">
            {records.slice(0, shown).map((r) => (
              <RecordItem
                key={r.id}
                record={r}
                media={r.mediaIds.map((m) => mediaById.get(m)).filter((m) => !!m)}
              />
            ))}
          </ul>
        )}
        {records.length > shown && (
          <button className="btn" onClick={() => setShown((n) => n + RECORDS_PAGE)}>
            さらに表示（残り {records.length - shown} 件）
          </button>
        )}
      </section>
    </div>
  )
}

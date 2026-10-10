import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db } from '../data/db'
import {
  achieveSkill,
  activateSkill,
  deactivateSkill,
  getSettings,
  recordsOf,
  revertAchievement,
} from '../data/repo'
import { canActivate, computeStates, indexById, prereqsDone } from '../domain/logic'
import { isWebUrl } from '../domain/template'
import type { Media } from '../domain/types'
import { ConfirmButton, Empty, formatDate, isVideo, splitName, StateBadge, STATE_LABEL } from './common'
import { PatternImage } from './PatternImage'
import { MediaItem } from './MediaItem'
import { RecordCard } from './RecordCard'
import { References } from './References'
import { useAction, useCelebrate, useToast } from './feedback'
import { backHandler, href } from './router'
import { BackIcon, PlayIcon } from './icons'

/** 動画をまとめて読み込むと重いので、記録は少しずつ出す */
const RECORDS_PAGE = 10
/** スキル画面では、まず新しいものを数件だけ出す */
const RECORDS_FIRST = 3


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
          <div key={m.id}>
            <MediaItem
              media={m}
              autoLoad
              videoRef={(el) => {
                videos.current[i] = el
              }}
            />
            <p className="compare-label">
              {i === 0 ? '最初' : '最新'}・{formatDate(m.createdAt)}
            </p>
          </div>
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
          <PlayIcon size={16} />
          同時に再生
        </button>
      )}
    </section>
  )
}

export function SkillScreen({ id }: { id: string }) {
  const run = useAction()
  const toast = useToast()
  const celebrate = useCelebrate()
  const [askingAchieve, setAskingAchieve] = useState(false)
  const [shown, setShown] = useState(RECORDS_FIRST)

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
  if (!data.skill) return <Empty>型が見つかりません。</Empty>
  const { skill, skills, domain, records, media, settings, allSkills } = data
  const states = computeStates(skills)
  const state = states.get(skill.id)!
  const byId = indexById(skills)
  const prereqs = skill.prereqIds.map((p) => byId.get(p)).filter((s) => !!s)
  const leadsTo = skills.filter((s) => s.prereqIds.includes(skill.id))
  const check = canActivate(skill, allSkills, settings.maxActive)
  const achievable = prereqsDone(skill, byId)
  const pendingPrereqs = prereqs.filter((p) => p.status !== 'done')
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
          <BackIcon size={26} />
        </a>
        <span className="title-block muted small">{domain?.name}</span>
        <a className="btn small ghost" href={href(`/skill/${skill.id}/edit`)}>
          編集
        </a>
      </header>

      <div className="skill-hero">
        <PatternImage name={skill.name} className="large" />
        <div className="skill-hero-text">
          <h1>{splitName(skill.name).main}</h1>
          {splitName(skill.name).sub && <span className="muted small">{splitName(skill.name).sub}</span>}
          <div className="row wrap">
            <StateBadge state={state} />
            {skill.achievedAt && <span className="muted small">{formatDate(skill.achievedAt)} にできた</span>}
          </div>
        </div>
      </div>

      <section className="criteria-box">
        <h2>合格の目安</h2>
        <p>{skill.criteria || '（未設定）編集から、判定できる目安を書いてください'}</p>
      </section>

      <div className="actions">
        {state === 'active' && (
          <a className="btn primary" href={href(`/record/${skill.id}/camera`)}>
            撮る
          </a>
        )}
        {state === 'available' && (
          <button
            className="btn primary"
            disabled={!check.ok}
            onClick={() =>
              run(async () => {
                await activateSkill(skill.id)
                toast.show(`「${splitName(skill.name).main}」の練習を始めます`)
              })
            }
          >
            練習を始める
          </button>
        )}
        {(state === 'active' || state === 'available') && !askingAchieve && (
          <button className="btn achieve" disabled={!achievable} onClick={() => setAskingAchieve(true)}>
            できた
          </button>
        )}
        {state === 'active' && (
          <button className="btn ghost" onClick={() => run(() => deactivateSkill(skill.id))}>
            練習をやめる
          </button>
        )}
        {state === 'done' && (
          <ConfirmButton
            className="btn ghost"
            confirmLabel="取り消す"
            message="「できた」を取り消します。この型を前提にしている練習中の型は、練習中から外れます。"
            onConfirm={() => run(() => revertAchievement(skill.id))}
          >
            「できた」を取り消す
          </ConfirmButton>
        )}
      </div>
      {state === 'available' && !check.ok && check.reason === 'limit' && (
        <p className="muted">練習中は {settings.maxActive} つまでです。いまの型を「できた」にするか、練習をやめると選べます。</p>
      )}
      {(state === 'active' || state === 'available') && !achievable && (
        <p className="muted small">
          並行して練習できます。「できた」にできるのは、「{pendingPrereqs.map((p) => splitName(p.name).main).join('」「')}」ができてからです。
        </p>
      )}

      {askingAchieve && (
        <div className="confirm achieve-confirm">
          <p>
            <strong>合格の目安を満たしましたか？</strong>
          </p>
          <p>{skill.criteria || '（合格の目安が未設定です）'}</p>
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
              はい、できた
            </button>
            <button className="btn" onClick={() => setAskingAchieve(false)}>
              まだ
            </button>
          </div>
        </div>
      )}

      {state === 'locked' && (
        <section className="section">
          <h2>先に練習する型</h2>
          <p className="muted small">これらの練習を始めると、この型も並行して練習できます。</p>
          <ul className="chips">
            {prereqs
              .filter((p) => p.status === 'idle')
              .map((p) => (
                <li key={p.id}>
                  <a href={href(`/skill/${p.id}`)}>{splitName(p.name).main}</a>
                </li>
              ))}
          </ul>
        </section>
      )}

      <Compare media={media} />

      <section className="section">
        <div className="section-head">
          <h2>記録（{records.length}）</h2>
          {(state === 'active' || state === 'available') && (
            <a className="btn small" href={href(`/record/${skill.id}/camera`)}>
              ＋ 撮る
            </a>
          )}
        </div>
        {records.length === 0 ? (
          <p className="muted">まだ記録がありません。</p>
        ) : (
          <ul className="records">
            {records.slice(0, shown).map((r) => (
              <RecordCard
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

      <References skill={skill} />


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
                    <a
                      href={href(`/skill/${p.id}`)}
                      aria-label={`${splitName(p.name).main}（${STATE_LABEL[states.get(p.id)!]}）`}
                    >
                      {splitName(p.name).main}
                      <span className="chip-state">{STATE_LABEL[states.get(p.id)!]}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {leadsTo.length > 0 && (
            <>
              <h2>できると進める先</h2>
              <ul className="chips">
                {leadsTo.map((s) => (
                  <li key={s.id}>
                    <a
                      href={href(`/skill/${s.id}`)}
                      aria-label={`${splitName(s.name).main}（${STATE_LABEL[states.get(s.id)!]}）`}
                    >
                      {splitName(s.name).main}
                      <span className="chip-state">{STATE_LABEL[states.get(s.id)!]}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

    </div>
  )
}

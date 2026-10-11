import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db, mediaByIndex } from '../data/db'
import {
  achieveSkill,
  activateSkill,
  deactivateSkill,
  getSettings,
  cupNumbers,
  recordsOf,
  revertAchievement,
} from '../data/repo'
import { canActivate, computeStates, indexById } from '../domain/logic'
import { recentForm } from '../domain/form'
import { isWebUrl } from '../domain/template'
import type { Media } from '../domain/types'
import { ConfirmButton, Empty, formatDate, isVideo, splitName, StateBadge, STATE_LABEL } from './common'
import { PatternImage } from './PatternImage'
import { FormDots, formSummary } from './FormDots'
import { MediaItem } from './MediaItem'
import { CupGrid } from './CupGrid'
import { pickCupMedia } from './cupImage'
import { References } from './References'
import { useAction, useCelebrate, useToast } from './feedback'
import { backHandler, href } from './router'
import { BackIcon, PlayIcon } from './icons'

/** 記録は写真の格子で、まず新しいものを数段だけ出し、少しずつ足す（3列なので3の倍数） */
const RECORDS_FIRST = 9
const RECORDS_PAGE = 12


/** 最新と最初を並べて、上達を目で見られるようにする（今日の画面と同じく、新しいほうを左に） */
function Compare({ media }: { media: Media[] }) {
  const videos = media.filter(isVideo)
  const images = media.filter((m) => !isVideo(m))
  // 2つ以上あって比べられる種類だけを選べるようにする（1つしかない種類を選ぶと、比べる欄ごと消えていた）
  const kinds = [...(videos.length >= 2 ? (['video'] as const) : []), ...(images.length >= 2 ? (['image'] as const) : [])]
  const [picked, setPicked] = useState<'video' | 'image'>()
  const players = useRef<(HTMLVideoElement | null)[]>([])
  const kind = picked && kinds.includes(picked) ? picked : kinds[0]
  if (!kind) return null
  const list = kind === 'video' ? videos : images
  const pair = [list[list.length - 1], list[0]]

  return (
    <section className="section">
      <div className="section-head">
        <h2>最新と最初</h2>
        {kinds.length > 1 && (
          <div className="segmented small">
            <button className={kind === 'video' ? 'selected' : ''} onClick={() => setPicked('video')}>
              動画
            </button>
            <button className={kind === 'image' ? 'selected' : ''} onClick={() => setPicked('image')}>
              写真
            </button>
          </div>
        )}
      </div>
      <div className="compare">
        {pair.map((m, i) => (
          <div key={m.id}>
            <MediaItem
              media={m}
              autoLoad
              videoRef={(el) => {
                players.current[i] = el
              }}
            />
            <p className="compare-label">
              {i === 0 ? '最新' : '最初'}・{formatDate(m.createdAt)}
            </p>
          </div>
        ))}
      </div>
      {kind === 'video' && (
        <button
          className="btn small"
          onClick={() => {
            for (const v of players.current) {
              if (!v) continue
              // iPhone は音の出る動画を1本しか同時に再生できず、後から再生した方だけが動くので、音を消して並べて再生する
              v.muted = true
              // 止めたら音を戻す（そのあと1本だけ再生したときに音が出るように）
              v.addEventListener('pause', () => (v.muted = false), { once: true })
              v.currentTime = 0
              v.play().catch(() => {
                // 自動再生が止められた場合は、各動画の再生ボタンで再生してもらう
              })
            }
          }}
        >
          <PlayIcon size={16} />
          同時に再生（音なし）
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
      mediaByIndex(db.media.where('skillId').equals(id)).then((list) => list.sort((a, b) => a.createdAt - b.createdAt)),
      getSettings(),
    ])
    // 上限は全分野の合計なので、挑戦できるかは全スキルで判定する
    const allSkills = await db.skills.toArray()
    // 杯の番号は、型に関係なく全部の記録の通し番号（No.）
    const numbers = await cupNumbers(records)
    return { skill, skills, domain, records, media, settings, allSkills, numbers }
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
  // 前提はおすすめの順。まだの型でも自由に始められ、「できた」にもできる
  const notStarted = state === 'available' || state === 'locked'
  const pendingPrereqs = prereqs.filter((p) => p.status !== 'done')
  const form = recentForm(records)
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

      {/* 決められた合格基準ではなく、最近の調子を見て「できた」を自分で決める */}
      <section className="form-box">
        <h2>最近の調子</h2>
        <FormDots form={form} />
        <p className="muted small">{formSummary(form)}</p>
      </section>

      <div className="actions">
        {state === 'active' && (
          <a className="btn primary" href={href(`/record/${skill.id}`)}>
            記録する
          </a>
        )}
        {notStarted && (
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
        {(state === 'active' || notStarted) && !askingAchieve && (
          <button className="btn achieve" onClick={() => setAskingAchieve(true)}>
            できた
          </button>
        )}
        {state === 'active' && (
          <button
            className="btn ghost"
            onClick={() =>
              run(async () => {
                await deactivateSkill(skill.id)
                toast.show('練習を中断しました。撮った記録はそのまま残ります')
              })
            }
          >
            練習を中断する
          </button>
        )}
        {state === 'done' && (
          <ConfirmButton
            className="btn ghost"
            confirmLabel="取り消す"
            message="「できた」を取り消します。撮った記録や、ほかの型の練習はそのままです。"
            onConfirm={() => run(() => revertAchievement(skill.id))}
          >
            「できた」を取り消す
          </ConfirmButton>
        )}
      </div>
      {notStarted && !check.ok && check.reason === 'limit' && (
        <p className="muted">練習中は {settings.maxActive} つまでです。いまの型を「できた」にするか、練習を中断すると始められます。</p>
      )}

      {askingAchieve && (
        <div className="confirm achieve-confirm">
          <p>
            <strong>この型を「できた」にしますか？</strong>
          </p>
          <p className="muted small">最近の調子：{formSummary(form)}。自分で納得できたら「できた」にしてください。</p>
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

      {state !== 'done' && pendingPrereqs.length > 0 && (
        <section className="section">
          <h2>おすすめの順</h2>
          <p className="muted small">ロードマップでは、先にこれらの型をすると進めやすくなります。この型から始めることもできます。</p>
          <ul className="chips">
            {pendingPrereqs.map((p) => (
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
          <h2>記録（{records.length}杯）</h2>
        </div>
        {records.length === 0 ? (
          <p className="muted">まだ記録がありません。</p>
        ) : (
          <CupGrid
            cups={records.slice(0, shown).map((r) => ({
              record: r,
              media: pickCupMedia(r.mediaIds.map((m) => mediaById.get(m))),
              number: data.numbers?.get(r.id) ?? 0,
              skillName: skill.name,
              failed: r.mediaIds.some((m) => mediaById.get(m)?.upload === 'failed'),
            }))}
          />
        )}
        {records.length > shown && (
          <button className="btn" onClick={() => setShown((n) => n + RECORDS_PAGE)}>
            さらに表示（残り {records.length - shown}杯）
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

      {skill.criteria && (
        <details className="section criteria-details">
          <summary>参考の目安</summary>
          <p className="prewrap">{skill.criteria}</p>
        </details>
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

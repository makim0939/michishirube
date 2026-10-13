import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, mediaByIndex } from '../data/db'
import { getVideoStorage } from '../data/videoStorage'
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
import { ConfirmButton, Empty, formatDate, splitName, StateBadge } from './common'
import { Compare } from './Compare'
import { PatternImage } from './PatternImage'
import { FormDots, formSummary } from './FormDots'
import { CupGrid } from './CupGrid'
import { pickCupMedia } from './cupImage'
import { useAction, useCelebrate, useToast } from './feedback'
import { backHandler, href } from './router'
import { BackIcon } from './icons'
import { AboutSkill, SkillTips } from './SkillTips'

/** 記録は写真の格子で、まず新しいものを数段だけ出し、少しずつ足す（3列なので3の倍数） */
const RECORDS_FIRST = 9
const RECORDS_PAGE = 12


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
    // アップの失敗は、保存先が YouTube のときだけ知らせる
    const uploads = (await getVideoStorage()) === 'youtube'
    return { skill, skills, domain, records, media, settings, allSkills, numbers, uploads }
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
            {/* 練習をやめるのは、状態の印の横に控えめに置く（「記録する」「できた」の並びを崩さないように） */}
            {state === 'active' && (
              <button
                type="button"
                className="quiet-button"
                onClick={() =>
                  run(async () => {
                    await deactivateSkill(skill.id)
                    toast.show('練習を中断しました。撮った記録はそのまま残ります')
                  })
                }
              >
                中断する
              </button>
            )}
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

      <Compare
        media={media}
        numberOf={(m) => data.numbers?.get(m.recordId)}
      />

      {/* 注ぐ前に読み返したい、自分の記録から作ったコツと手本の動画 */}
      <SkillTips skill={skill} records={records} numbers={data.numbers} />

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
              failed: data.uploads && r.mediaIds.some((m) => mediaById.get(m)?.upload === 'failed'),
            }))}
          />
        )}
        {records.length > shown && (
          <button className="btn" onClick={() => setShown((n) => n + RECORDS_PAGE)}>
            さらに表示（残り {records.length - shown}杯）
          </button>
        )}
      </section>

      <AboutSkill skill={skill} prereqs={prereqs} leadsTo={leadsTo} states={states} />
    </div>
  )
}

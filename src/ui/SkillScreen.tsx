import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, mediaByIndex } from '../data/db'
import { getVideoStorage } from '../data/videoStorage'
import {
  achieveSkill,
  cupNumbers,
  practicingSkillIds,
  recordsOf,
  revertAchievement,
} from '../data/repo'
import { computeStates, indexById } from '../domain/logic'
import { recentForm } from '../domain/form'
import { formatDateTime } from '../domain/format'
import { ConfirmButton, Empty, splitName, StateBadge } from './common'
import { Compare } from './Compare'
import { PatternImage } from './PatternImage'
import { FormDots, formSummary } from './FormDots'
import { CupGrid } from './CupGrid'
import { pickCupMedia } from './cupImage'
import { useAction, useCelebrate } from './feedback'
import { backHandler, href } from './router'
import { BackIcon } from './icons'
import { AboutSkill, SkillTips } from './SkillTips'
import { t } from '../i18n'

/** 記録は写真の格子で、まず新しいものを数段だけ出し、少しずつ足す（3列なので3の倍数） */
const RECORDS_FIRST = 9
const RECORDS_PAGE = 12

export function SkillScreen({ id }: { id: string }) {
  const run = useAction()
  const celebrate = useCelebrate()
  const [askingAchieve, setAskingAchieve] = useState(false)
  const [shown, setShown] = useState(RECORDS_FIRST)

  const data = useLiveQuery(async () => {
    const skill = await db.skills.get(id)
    if (!skill) return { skill: undefined }
    const [skills, domain, records, media, practicing] = await Promise.all([
      db.skills.where('domainId').equals(skill.domainId).toArray(),
      db.domains.get(skill.domainId),
      recordsOf(id),
      mediaByIndex(db.media.where('skillId').equals(id)).then((list) => list.sort((a, b) => a.createdAt - b.createdAt)),
      practicingSkillIds(),
    ])
    // 杯の番号は、型に関係なく全部の記録の通し番号（No.）
    const numbers = await cupNumbers(records)
    // アップの失敗は、保存先が YouTube のときだけ知らせる
    const uploads = (await getVideoStorage()) === 'youtube'
    return { skill, skills, domain, records, media, numbers, uploads, practicing }
  }, [id])

  if (!data) return null
  if (!data.skill) return <Empty>{t.common.skillNotFound}</Empty>
  const { skill, skills, domain, records, media } = data
  const states = computeStates(skills, data.practicing)
  const state = states.get(skill.id)!
  const byId = indexById(skills)
  const prereqs = skill.prereqIds.map((p) => byId.get(p)).filter((s) => !!s)
  const leadsTo = skills.filter((s) => s.prereqIds.includes(skill.id))
  const form = recentForm(records)
  const { main, sub } = splitName(skill.name)
  const mediaById = new Map(media.map((m) => [m.id, m]))

  return (
    <div className="screen">
      <header className="screen-header">
        <a
          className="back"
          href={href(`/map/${skill.domainId}`)}
          onClick={backHandler(`/map/${skill.domainId}`)}
          aria-label={t.common.back}
        >
          <BackIcon size={26} />
        </a>
        <span className="title-block muted small">{domain?.name}</span>
        <a className="btn small ghost" href={href(`/skill/${skill.id}/edit`)}>
          {t.common.edit}
        </a>
      </header>

      <div className="skill-hero">
        <PatternImage name={skill.name} className="large" />
        <div className="skill-hero-text">
          <h1>{main}</h1>
          {sub && <span className="muted small">{sub}</span>}
          <div className="row wrap">
            <StateBadge state={state} />
            {skill.achievedAt && <span className="muted small">{t.skill.achievedAt(formatDateTime(skill.achievedAt))}</span>}
          </div>
        </div>
      </div>

      {/* 決められた合格基準ではなく、最近の調子を見て「できた」を自分で決める */}
      <section className="form-box">
        <h2>{t.skill.form}</h2>
        <FormDots form={form} />
        <p className="muted small">{formSummary(form)}</p>
      </section>

      {/* どの型でも、すぐ記録できる（最近記録した型が「練習中」になり、今日の画面に出る） */}
      <div className="actions">
        <a className="btn primary" href={href(`/record/${skill.id}`)}>
          {t.common.record}
        </a>
        {/* 「できた」は、このアプリでいちばんうれしい瞬間のボタンなので、金色で並べて見せる */}
        {state !== 'done' && !askingAchieve && (
          <button className="btn achieve" onClick={() => setAskingAchieve(true)}>
            {t.state.done}
          </button>
        )}
      </div>

      {/* 「取り消す」は、まれで、戻す操作なので、静かなボタンにする。
          確認は、2つ並べたボタンの中ではなく、その下に広げる（横に押し込むと、「記録する」が縦に伸びて崩れる） */}
      {state === 'done' && (
        <ConfirmButton
          className="btn small ghost"
          confirmLabel={t.skill.revertConfirm}
          message={t.skill.revertMessage}
          onConfirm={() => run(() => revertAchievement(skill.id))}
        >
          {t.skill.revert}
        </ConfirmButton>
      )}

      {askingAchieve && (
        <div className="confirm achieve-confirm">
          <p>
            <strong>{t.skill.achieveAsk}</strong>
          </p>
          <p className="muted small">{t.skill.achieveHint(formSummary(form))}</p>
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
              {t.skill.achieveYes}
            </button>
            <button className="btn ghost" onClick={() => setAskingAchieve(false)}>
              {t.skill.achieveNo}
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
          <h2>{t.skill.records(records.length)}</h2>
        </div>
        {records.length === 0 ? (
          <p className="muted">{t.common.noRecordsYet}</p>
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
            {t.skill.showMore(records.length - shown)}
          </button>
        )}
      </section>

      <AboutSkill skill={skill} prereqs={prereqs} leadsTo={leadsTo} states={states} />
    </div>
  )
}

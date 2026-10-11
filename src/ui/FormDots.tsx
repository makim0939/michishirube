import { FORM_WINDOW, type RecentForm } from '../domain/form'
import { OUTCOME_MARK } from '../domain/format'

/** 最近の調子を点で並べる（左がいちばん新しい）。◎は濃く、△は薄く、✕は赤、結果を付けなかった杯は空の丸 */
export function FormDots({ form }: { form: RecentForm }) {
  if (form.outcomes.length === 0) return null
  const label = `直近${form.outcomes.length}杯：${OUTCOME_MARK.good}${form.good} ${OUTCOME_MARK.meh}${form.meh} ${OUTCOME_MARK.bad}${form.bad}`
  return (
    <span className="form-dots" role="img" aria-label={label}>
      {form.outcomes.map((o, i) => (
        <span key={i} className={`form-dot is-${o ?? 'unmarked'}`} />
      ))}
      {Array.from({ length: FORM_WINDOW - form.outcomes.length }, (_, i) => (
        <span key={`slot-${i}`} className="form-dot is-slot" />
      ))}
    </span>
  )
}

/** 最近の調子を文で（型の詳細・「できた」の確認） */
export function formSummary(form: RecentForm): string {
  if (form.outcomes.length === 0) return 'まだ記録がありません'
  return `直近${form.outcomes.length}杯で ${OUTCOME_MARK.good}${form.good}・${OUTCOME_MARK.meh}${form.meh}・${OUTCOME_MARK.bad}${form.bad}`
}

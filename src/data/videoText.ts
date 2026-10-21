import { formatDate, formatDateTime, OUTCOME_LABEL } from '../domain/format'
import type { Domain, PracticeRecord, Skill } from '../domain/types'
import { SITE_URL } from '../platform'
import { db } from './db'

/**
 * YouTube に付けるタイトルと説明の「書き方」（テンプレート）。
 * `{型}` のように波かっこで囲んだ項目が、動画ごとの記録の中身に置き換わる。端末ごとの設定（動画の設定と同じ）
 */
export const TEMPLATE_FIELDS = ['分野', '型', '日付', '日時', '結果', '原因', 'メモ', '次の一手'] as const
export type TemplateField = (typeof TEMPLATE_FIELDS)[number]
export type TemplateVars = Partial<Record<TemplateField, string>>

export const DEFAULT_TITLE = '{分野}｜{型}｜{日時}'
/** 最後の2行は、説明欄のリンクから、アプリの紹介ページに来てもらうため */
export const DEFAULT_DESCRIPTION = ['{結果}', '原因：{原因}', 'メモ：{メモ}', '次の一手：{次の一手}', '', 'ラテ帳で記録', SITE_URL].join('\n')

const TITLE_KEY = 'youtubeTitleTemplate'
const DESCRIPTION_KEY = 'youtubeDescriptionTemplate'

/** YouTube の上限（タイトル100文字・説明5000バイト）に収める。「<」「>」は YouTube が受け付けない */
const TITLE_MAX = 100
const DESCRIPTION_MAX = 4900

/**
 * テンプレートに記録の中身を入れる。
 * 項目を含む行は、入る中身がすべて空なら行ごと消す（メモが無い記録に「メモ：」だけが残らないように）。
 * 知らない項目名（打ち間違い）は、そのまま残す（プレビューで気づけるように）
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const known: readonly string[] = TEMPLATE_FIELDS
  const out: string[] = []
  for (const line of template.split(/\r?\n/)) {
    let hasField = false
    let filled = false
    const text = line.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
      if (!known.includes(name)) return whole
      hasField = true
      const value = vars[name as TemplateField] ?? ''
      if (value) filled = true
      return value
    })
    if (hasField && !filled) continue
    out.push(text)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function clean(text: string) {
  return text.replace(/[<>]/g, '')
}

export interface VideoTemplates {
  title: string
  description: string
}

/** 保存したテンプレートから、YouTube に付けるタイトルと説明を作る */
export function buildVideoText(templates: VideoTemplates, vars: TemplateVars): { title: string; description: string } {
  // タイトルは1行。項目が空で「｜」が続いたら、1つにまとめる
  const oneLine = (t: string) =>
    clean(renderTemplate(t, vars))
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/(\s*｜\s*){2,}/g, '｜')
      .replace(/^\s*｜\s*|\s*｜\s*$/g, '')
  const title = oneLine(templates.title) || oneLine(DEFAULT_TITLE) || 'ラテ帳'
  return { title: title.slice(0, TITLE_MAX), description: clean(renderTemplate(templates.description, vars)).slice(0, DESCRIPTION_MAX) }
}

/** 記録・型・分野から、テンプレートに入れる中身を作る。ts は動画を撮った時刻 */
export function templateVars(ts: number, record?: PracticeRecord, skill?: Skill, domain?: Domain): TemplateVars {
  return {
    分野: domain?.name,
    型: skill?.name,
    日付: formatDate(ts),
    日時: formatDateTime(ts),
    結果: record?.outcome ? OUTCOME_LABEL[record.outcome] : undefined,
    原因: record?.causes?.length ? record.causes.join('・') : undefined,
    メモ: record?.reason || undefined,
    次の一手: record?.nextAction || undefined,
  }
}

/** 読むだけなので、liveQuery の中でも使える。まだ変えていなければ標準 */
export async function getVideoTemplates(): Promise<VideoTemplates> {
  const [title, description] = await Promise.all([db.meta.get(TITLE_KEY), db.meta.get(DESCRIPTION_KEY)])
  return {
    title: typeof title?.value === 'string' ? title.value : DEFAULT_TITLE,
    description: typeof description?.value === 'string' ? description.value : DEFAULT_DESCRIPTION,
  }
}

/** 標準と同じなら、保存を消す（標準の書き方を将来直したとき、変えていない人には届くように）。タイトルが空なら標準にする */
export async function setVideoTemplate(kind: 'title' | 'description', value: string) {
  const key = kind === 'title' ? TITLE_KEY : DESCRIPTION_KEY
  const standard = kind === 'title' ? DEFAULT_TITLE : DEFAULT_DESCRIPTION
  if (value === standard || (kind === 'title' && value.trim() === '')) await db.meta.delete(key)
  else await db.meta.put({ key, value })
}

export async function resetVideoTemplates() {
  await db.meta.bulkDelete([TITLE_KEY, DESCRIPTION_KEY])
}

/** プレビュー用。いちばん新しい記録があればその中身、なければ見本 */
export async function previewVars(): Promise<{ vars: TemplateVars; sample: boolean }> {
  const record = await db.records.orderBy('createdAt').last()
  if (record) {
    const skill = await db.skills.get(record.skillId)
    const domain = skill ? await db.domains.get(skill.domainId) : undefined
    return { vars: templateVars(record.createdAt, record, skill, domain), sample: false }
  }
  const now = Date.now()
  return {
    vars: { 分野: 'ラテアート', 型: 'ハート', 日付: formatDate(now), 日時: formatDateTime(now), 結果: OUTCOME_LABEL.meh, 次の一手: 'ミルクを高い位置から入れる' },
    sample: true,
  }
}

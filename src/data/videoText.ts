import { formatDate, formatDateTime, OUTCOME_LABEL } from '../domain/format'
import type { PracticeRecord, Skill } from '../domain/types'
import { t } from '../i18n'
import { en } from '../i18n/en'
import { SITE_URL } from '../platform'
import { db } from './db'

/**
 * YouTube に付けるタイトルと説明の「書き方」（テンプレート）。
 * `{型}` のように波かっこで囲んだ項目が、動画ごとの記録の中身に置き換わる。端末ごとの設定（動画の設定と同じ）。
 * 項目の名前は、日本語の名前を元にする（保存したテンプレートと、中身の受け渡しで使う）
 */
export const TEMPLATE_FIELDS = ['型', '日付', '日時', '結果', 'メモ', '次の一手'] as const
export type TemplateField = (typeof TEMPLATE_FIELDS)[number]
export type TemplateVars = Partial<Record<TemplateField, string>>

/** 画面に出す項目の名前（いまの言語）。英語では `{pattern}` のように書く */
export const TEMPLATE_FIELD_LABEL: Record<TemplateField, string> = t.videoText.fields

/** 英語の項目名 → 元の名前。言語を変えても、前に書いたテンプレートがそのまま使えるよう、どちらの名前も受け付ける */
const EN_FIELD: Record<string, TemplateField> = Object.fromEntries(
  Object.entries(en.videoText.fields).map(([field, name]) => [name.toLowerCase(), field as TemplateField]),
)

export const DEFAULT_TITLE = t.videoText.defaultTitle
/** 最後の2行は、説明欄のリンクから、アプリの紹介ページに来てもらうため */
export const DEFAULT_DESCRIPTION = t.videoText.defaultDescription(SITE_URL)

const TITLE_KEY = 'youtubeTitleTemplate'
const DESCRIPTION_KEY = 'youtubeDescriptionTemplate'

/** YouTube の上限（タイトル100文字・説明5000バイト）に収める。「<」「>」は YouTube が受け付けない */
const TITLE_MAX = 100
const DESCRIPTION_MAX_BYTES = 4900

/** UTF-8 で max バイトまでに切る（日本語は1文字3バイトなので、文字数では足りない）。文字の途中では切らない */
function cutBytes(text: string, max: number): string {
  const enc = new TextEncoder()
  let bytes = 0
  let out = ''
  for (const ch of text) {
    bytes += enc.encode(ch).length
    if (bytes > max) break
    out += ch
  }
  return out
}

/**
 * テンプレートに記録の中身を入れる。
 * 項目を含む行は、入る中身がすべて空なら行ごと消す（メモが無い記録に「メモ：」だけが残らないように）。
 * 知らない項目名（打ち間違い）は、そのまま残す（プレビューで気づけるように）
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const known: readonly string[] = TEMPLATE_FIELDS
  const fieldOf = (name: string): TemplateField | undefined =>
    known.includes(name) ? (name as TemplateField) : EN_FIELD[name.toLowerCase()]
  const out: string[] = []
  for (const line of template.split(/\r?\n/)) {
    let hasField = false
    let filled = false
    const text = line.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
      const field = fieldOf(name)
      if (!field) return whole
      hasField = true
      const value = vars[field] ?? ''
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
  // タイトルは1行。項目が空で「｜」（英語は「|」）が続いたら、1つにまとめる
  const oneLine = (text: string) =>
    clean(renderTemplate(text, vars))
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/(\s*｜\s*){2,}/g, '｜')
      .replace(/(\s*\|\s*){2,}/g, ' | ')
      .replace(/^\s*[｜|]\s*|\s*[｜|]\s*$/g, '')
  const title = oneLine(templates.title) || oneLine(DEFAULT_TITLE) || t.settings.appName
  return { title: title.slice(0, TITLE_MAX), description: cutBytes(clean(renderTemplate(templates.description, vars)), DESCRIPTION_MAX_BYTES) }
}

/** 記録・型から、テンプレートに入れる中身を作る。ts は動画を撮った時刻 */
export function templateVars(ts: number, record?: PracticeRecord, skill?: Skill): TemplateVars {
  return {
    型: skill?.name,
    日付: formatDate(ts),
    日時: formatDateTime(ts),
    結果: record?.outcome ? OUTCOME_LABEL[record.outcome] : undefined,
    メモ: record?.reason || undefined,
    次の一手: record?.nextAction || undefined,
  }
}

/** 標準の書き方から変えているか */
export function isCustomTemplates(t: VideoTemplates): boolean {
  return t.title !== DEFAULT_TITLE || t.description !== DEFAULT_DESCRIPTION
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
    // 実際のタイトルは動画を撮った時刻を使うので、プレビューも、その記録の最後の動画の時刻にそろえる
    const media = record.mediaIds.length ? await db.media.get(record.mediaIds[record.mediaIds.length - 1]) : undefined
    return { vars: templateVars(media?.createdAt ?? record.createdAt, record, skill), sample: false }
  }
  const now = Date.now()
  return {
    vars: { 型: t.videoText.sampleSkill, 日付: formatDate(now), 日時: formatDateTime(now), 結果: OUTCOME_LABEL.meh, 次の一手: t.videoText.sampleNext },
    sample: true,
  }
}

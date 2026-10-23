import { describe, expect, it } from 'vitest'
import { db } from './db'
import { videoMeta } from './youtube'
import type { Media } from '../domain/types'
import {
  buildVideoText,
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  getVideoTemplates,
  isCustomTemplates,
  renderTemplate,
  resetVideoTemplates,
  setVideoTemplate,
  templateVars,
} from './videoText'

const full = { 型: 'ハート', 日時: '2026/10/10 9:05', 結果: '◎ 成功', メモ: '良かった', 次の一手: '高く注ぐ' }

describe('YouTube のタイトルと説明の書き方', () => {
  it('標準の書き方は、これまでと同じタイトルと説明になる', () => {
    const { title, description } = buildVideoText({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION }, full)
    expect(title).toBe('ラテアート｜ハート｜2026/10/10 9:05')
    expect(description.split('\n').slice(0, 3)).toEqual(['◎ 成功', 'メモ：良かった', '次の一手：高く注ぐ'])
    expect(description).toContain('ラテ帳で記録')
  })

  it('中身が空の項目を含む行は、行ごと消える（「メモ：」だけが残らない）', () => {
    expect(renderTemplate('{結果}\nメモ：{メモ}\n次の一手：{次の一手}', { 結果: '◎ 成功', 次の一手: 'x' })).toBe('◎ 成功\n次の一手：x')
  })

  it('項目のない行は、そのまま残す。連続する空行は1つにまとめる', () => {
    expect(renderTemplate('a\n\n{メモ}\n\nb', {})).toBe('a\n\nb')
  })

  it('知らない項目名は、そのまま残す（打ち間違いに気づけるように）', () => {
    expect(renderTemplate('{がんば}と{型}', { 型: 'ハート' })).toBe('{がんば}とハート')
  })

  it('タイトルは、項目が空で「｜」が続いても1つにまとめ、100文字までにする', () => {
    expect(buildVideoText({ title: '{型}｜{結果}｜{日時}', description: '' }, { 日時: 'x' }).title).toBe('x')
    expect(buildVideoText({ title: 'あ'.repeat(150), description: '' }, {}).title).toHaveLength(100)
  })

  it('タイトルが空なら標準にする。「<」「>」は YouTube が受け付けないので取る', () => {
    expect(buildVideoText({ title: '  ', description: '' }, full).title).toBe('ラテアート｜ハート｜2026/10/10 9:05')
    expect(buildVideoText({ title: '<{型}>', description: 'a<b>' }, full)).toEqual({ title: 'ハート', description: 'ab' })
  })

  it('項目は英語の名前でも書ける（言語を切り替えても、前に書いた書き方がそのまま使える）', () => {
    expect(renderTemplate('{pattern} | {Next Step}\nNotes: {notes}', full)).toBe('ハート | 高く注ぐ\nNotes: 良かった')
  })

  it('説明を空にすれば、説明なしで上がる', () => {
    expect(buildVideoText({ title: '{型}', description: '' }, full).description).toBe('')
  })

  it('記録の中身を項目に入れる', () => {
    const v = templateVars(0, { outcome: 'meh', reason: '', nextAction: 'n' } as never)
    expect(v.結果).toContain('惜しい')
    expect(v.次の一手).toBe('n')
    expect(v.メモ).toBeUndefined()
  })
})

describe('説明の長さ', () => {
  it('YouTube の上限はバイトなので、日本語でも 5000 バイトに収める', () => {
    const { description } = buildVideoText({ title: '{型}', description: 'あ'.repeat(3000) }, full)
    expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(4900)
    expect(description).toMatch(/^あ+$/)
  })
})

describe('書き方の保存', () => {
  const media = { id: 'm1', recordId: 'none', skillId: 'none', type: 'video/mp4', createdAt: 1 } as Media

  it('変えていなければ標準。変えたものは、動画に付くタイトルに反映される', async () => {
    await resetVideoTemplates()
    expect(isCustomTemplates(await getVideoTemplates())).toBe(false)
    await setVideoTemplate('title', '練習 {日付}')
    expect(isCustomTemplates(await getVideoTemplates())).toBe(true)
    expect((await videoMeta(media)).title).toMatch(/^練習 \d{4}\/\d+\/\d+$/)
    await resetVideoTemplates()
  })

  it('標準と同じ内容を保存したときと、タイトルを空にしたときは、保存を消して標準にもどる', async () => {
    await setVideoTemplate('title', 'x')
    await setVideoTemplate('title', DEFAULT_TITLE)
    expect(await db.meta.get('youtubeTitleTemplate')).toBeUndefined()
    await setVideoTemplate('title', 'x')
    await setVideoTemplate('title', '')
    expect((await getVideoTemplates()).title).toBe(DEFAULT_TITLE)
  })

  it('説明は、空にして保存できる（説明なしで上がる）', async () => {
    await setVideoTemplate('description', '')
    expect((await getVideoTemplates()).description).toBe('')
    expect((await videoMeta(media)).description).toBe('')
    await resetVideoTemplates()
  })
})

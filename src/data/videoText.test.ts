import { describe, expect, it } from 'vitest'
import { buildVideoText, DEFAULT_DESCRIPTION, DEFAULT_TITLE, renderTemplate, templateVars } from './videoText'

const full = { 分野: 'ラテアート', 型: 'ハート', 日時: '2026/10/10 9:05', 結果: '◎ 成功', 原因: '注ぎ方', メモ: '良かった', 次の一手: '高く注ぐ' }

describe('YouTube のタイトルと説明の書き方', () => {
  it('標準の書き方は、これまでと同じタイトルと説明になる', () => {
    const { title, description } = buildVideoText({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION }, full)
    expect(title).toBe('ラテアート｜ハート｜2026/10/10 9:05')
    expect(description.split('\n').slice(0, 4)).toEqual(['◎ 成功', '原因：注ぎ方', 'メモ：良かった', '次の一手：高く注ぐ'])
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
    expect(buildVideoText({ title: '{分野}｜{型}｜{日時}', description: '' }, { 日時: 'x' }).title).toBe('x')
    expect(buildVideoText({ title: 'あ'.repeat(150), description: '' }, {}).title).toHaveLength(100)
  })

  it('タイトルが空なら標準にする。「<」「>」は YouTube が受け付けないので取る', () => {
    expect(buildVideoText({ title: '  ', description: '' }, full).title).toBe('ラテアート｜ハート｜2026/10/10 9:05')
    expect(buildVideoText({ title: '<{型}>', description: 'a<b>' }, full)).toEqual({ title: 'ハート', description: 'ab' })
  })

  it('説明を空にすれば、説明なしで上がる', () => {
    expect(buildVideoText({ title: '{型}', description: '' }, full).description).toBe('')
  })

  it('記録の中身を項目に入れる（原因は「・」でつなぐ）', () => {
    const v = templateVars(0, { outcome: 'meh', causes: ['a', 'b'], reason: '', nextAction: 'n' } as never)
    expect(v.結果).toContain('惜しい')
    expect(v.原因).toBe('a・b')
    expect(v.メモ).toBeUndefined()
  })
})

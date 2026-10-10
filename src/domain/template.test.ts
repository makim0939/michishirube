import { describe, expect, it } from 'vitest'
import latteArt from '../roadmaps/latte-art.json'
import { TemplateError, entitiesToTemplate, parseTemplate, templateToEntities } from './template'

const base = { version: 1, domain: 'ピアノ' }

describe('parseTemplate', () => {
  it('同梱のラテアートのロードマップは正しい形式で、どのスキルにも出典と達成条件がある', () => {
    const t = parseTemplate(latteArt)
    expect(t.skills.length).toBeGreaterThan(5)
    for (const s of t.skills) {
      // レイヤーハートだけは信頼できる出典が見つかっていない（達成条件も自分で決める）
      if (s.key !== 'layer-heart') expect(s.sources?.length, s.name).toBeGreaterThan(0)
      expect(s.criteria, s.name).not.toBe('')
    }
  })

  it('存在しない前提・重複した key・循環をはじく', () => {
    expect(() => parseTemplate({ ...base, skills: [{ key: 'a', name: 'A', criteria: '', prereqs: ['z'] }] })).toThrow(
      TemplateError,
    )
    expect(() =>
      parseTemplate({
        ...base,
        skills: [
          { key: 'a', name: 'A', criteria: '' },
          { key: 'a', name: 'B', criteria: '' },
        ],
      }),
    ).toThrow(/重複/)
    expect(() =>
      parseTemplate({
        ...base,
        skills: [
          { key: 'a', name: 'A', criteria: '', prereqs: ['b'] },
          { key: 'b', name: 'B', criteria: '', prereqs: ['a'] },
        ],
      }),
    ).toThrow(/循環/)
  })
})

describe('templateToEntities / entitiesToTemplate', () => {
  it('key を id に置き換え、書き出すと同じ構造に戻る', () => {
    let n = 0
    const t = parseTemplate({
      ...base,
      skills: [
        { key: 'scale', name: 'スケール', criteria: 'ハ長調を両手で' },
        { key: 'song', name: '曲', criteria: '通して弾ける', prereqs: ['scale'] },
      ],
    })
    const { domain, skills } = templateToEntities(t, { now: 1000, order: 1, newId: () => `id${++n}` })
    expect(skills[1].prereqIds).toEqual([skills[0].id])
    expect(skills.every((s) => s.domainId === domain.id && s.status === 'idle')).toBe(true)

    const back = entitiesToTemplate(domain, skills)
    expect(back.skills.map((s) => [s.name, s.prereqs])).toEqual([
      ['スケール', []],
      ['曲', ['s1']],
    ])
  })
})

describe('出典の URL', () => {
  it('http(s) 以外の URL をはじく', () => {
    const t = (url: string) => ({
      ...base,
      skills: [{ key: 'a', name: 'A', criteria: '', sources: [{ title: 't', url }] }],
    })
    expect(() => parseTemplate(t('javascript:alert(1)'))).toThrow(/http/)
    expect(parseTemplate(t('https://example.com')).skills[0].sources?.[0].url).toBe('https://example.com')
  })
})

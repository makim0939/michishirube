import { describe, expect, it } from 'vitest'
import latteArt from '../roadmaps/latte-art.json'
import { TemplateError, entitiesToTemplate, parseTemplate, templateToEntities } from './template'

const base = { version: 1, domain: 'ピアノ' }

describe('parseTemplate', () => {
  it('同梱のラテアートのロードマップは正しい形式で、説明・目安・出典を持たない', () => {
    const t = parseTemplate(latteArt)
    expect(t.skills.map((s) => s.name)).toEqual([
      'ハート',
      'チューリップ',
      'ロゼッタ（リーフ）',
      'レイヤーハート',
      'ウィングチューリップ',
      'ウィングハート',
      'スワン',
    ])
    for (const s of t.skills) expect(s.description, s.name).toBe('')
    // 順序は開発者が決める。スワンは、どちらのウィングからでも進める（前提はどれか1つでよい）
    const prereqs = Object.fromEntries(t.skills.map((s) => [s.key, s.prereqs]))
    expect(prereqs).toEqual({
      heart: [],
      tulip: ['heart'],
      rosetta: ['tulip'],
      'layer-heart': ['rosetta'],
      'wing-tulip': ['rosetta'],
      'wing-heart': ['layer-heart'],
      swan: ['wing-tulip', 'wing-heart'],
    })
  })

  it('存在しない前提・重複した key・循環をはじく', () => {
    expect(() => parseTemplate({ ...base, skills: [{ key: 'a', name: 'A', prereqs: ['z'] }] })).toThrow(
      TemplateError,
    )
    expect(() =>
      parseTemplate({
        ...base,
        skills: [
          { key: 'a', name: 'A' },
          { key: 'a', name: 'B' },
        ],
      }),
    ).toThrow(/重複/)
    expect(() =>
      parseTemplate({
        ...base,
        skills: [
          { key: 'a', name: 'A', prereqs: ['b'] },
          { key: 'b', name: 'B', prereqs: ['a'] },
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
        { key: 'scale', name: 'スケール' },
        { key: 'song', name: '曲', prereqs: ['scale'] },
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

describe('古い形式', () => {
  it('出典・参考の目安（criteria）が入っていても、読み込んで捨てる', () => {
    const t = parseTemplate({
      ...base,
      skills: [{ key: 'a', name: 'A', criteria: '10回中8回', sources: [{ title: 't', url: 'javascript:alert(1)' }] }],
    })
    expect(t.skills[0]).not.toHaveProperty('sources')
    expect(t.skills[0]).not.toHaveProperty('criteria')
  })
})

import { describe, expect, it } from 'vitest'
import {
  canAchieve,
  canActivate,
  computeStates,
  descendants,
  indexById,
  moveItem,
  newlyUnlocked,
  orderBy,
  sortByDepth,
  wouldCreateCycle,
} from './logic'
import type { Skill, SkillStatus } from './types'

function skill(id: string, prereqIds: string[] = [], status: SkillStatus = 'idle'): Skill {
  return {
    id,
    domainId: 'd',
    name: id,
    description: '',
    criteria: '',
    sources: [],
    references: [],
    prereqIds,
    status,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('computeStates', () => {
  it('前提がすべて達成済みなら解放、そうでなければロック', () => {
    const skills = [skill('a', [], 'done'), skill('b', ['a']), skill('c', ['a', 'b']), skill('d', [], 'active')]
    const states = computeStates(skills)
    expect(states.get('a')).toBe('done')
    expect(states.get('b')).toBe('available')
    expect(states.get('c')).toBe('locked')
    expect(states.get('d')).toBe('active')
  })

  it('前提が挑戦中なら並行して挑戦できるが、達成は前提を達成してから', () => {
    const skills = [skill('steam', [], 'active'), skill('dot', ['steam']), skill('heart', ['dot'])]
    const states = computeStates(skills)
    expect(states.get('dot')).toBe('available')
    expect(states.get('heart')).toBe('locked')
    const byId = indexById(skills)
    expect(canAchieve(skills[1], byId)).toBe(false)
    expect(canAchieve(skills[0], byId)).toBe(true)

    // ドットも挑戦中にすると、ハートも並行して練習できる
    const next = [skills[0], { ...skills[1], status: 'active' as const }, skills[2]]
    expect(computeStates(next).get('heart')).toBe('available')
  })
})

describe('canActivate', () => {
  it('上限は全分野の合計で数える', () => {
    const skills = [skill('a', [], 'active'), { ...skill('b', [], 'active'), domainId: 'other' }, skill('c')]
    expect(canActivate(skills[2], skills, 2)).toEqual({ ok: false, reason: 'limit' })
    expect(canActivate(skills[2], skills, 3)).toEqual({ ok: true })
  })

  it('達成済み・練習中は練習中にできない。前提がまだでも始められる', () => {
    const skills = [skill('a', [], 'done'), skill('b', ['x']), skill('c', [], 'active')]
    expect(canActivate(skills[0], skills, 3)).toEqual({ ok: false, reason: 'done' })
    expect(canActivate(skills[1], skills, 3)).toEqual({ ok: true })
    expect(canActivate(skills[2], skills, 3)).toEqual({ ok: false, reason: 'already' })
  })
})

describe('newlyUnlocked', () => {
  it('ほかの前提も満たしているものだけを返す', () => {
    const skills = [skill('a'), skill('b', [], 'done'), skill('c', ['a', 'b']), skill('d', ['a', 'x']), skill('e', ['b'])]
    expect(newlyUnlocked('a', skills).map((s) => s.id)).toEqual(['c'])
  })
})

describe('wouldCreateCycle / descendants', () => {
  const skills = [skill('a'), skill('b', ['a']), skill('c', ['b'])]

  it('後ろのスキルを前提にすると循環になる', () => {
    expect(wouldCreateCycle('a', ['c'], skills)).toBe(true)
    expect(wouldCreateCycle('c', ['a'], skills)).toBe(false)
  })

  it('後ろのスキルをすべて返す', () => {
    expect([...descendants('a', skills)].sort()).toEqual(['b', 'c'])
  })
})

describe('sortByDepth', () => {
  it('前提の深さ順に並べる', () => {
    const skills = [skill('c', ['b']), skill('b', ['a']), skill('a')]
    expect(sortByDepth(skills).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('orderBy', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const ids = (list: { id: string }[]) => list.map((x) => x.id)

  it('決めた順に並べ、入っていないものは元の並びのまま後ろに付ける', () => {
    expect(ids(orderBy(items, ['c', 'a'], (x) => x.id))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('順が無ければ元の並びのまま', () => {
    expect(ids(orderBy(items, undefined, (x) => x.id))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('もう無い id は無視する', () => {
    expect(ids(orderBy(items, ['x', 'd'], (x) => x.id))).toEqual(['d', 'a', 'b', 'c'])
  })
})

describe('moveItem', () => {
  it('前へも後ろへも動かせ、範囲の外は端に寄せる', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 0, 9)).toEqual(['b', 'c', 'a'])
  })
})

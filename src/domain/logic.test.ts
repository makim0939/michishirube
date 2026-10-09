import { describe, expect, it } from 'vitest'
import {
  canActivate,
  computeStates,
  descendants,
  invalidActives,
  newlyUnlocked,
  sortByDepth,
  wouldCreateCycle,
} from './logic'
import type { Skill, SkillStatus } from './types'

function skill(id: string, prereqIds: string[] = [], status: SkillStatus = 'idle'): Skill {
  return { id, domainId: 'd', name: id, description: '', criteria: '', sources: [], prereqIds, status, createdAt: 0 }
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
})

describe('canActivate', () => {
  it('上限は全分野の合計で数える', () => {
    const skills = [skill('a', [], 'active'), { ...skill('b', [], 'active'), domainId: 'other' }, skill('c')]
    expect(canActivate(skills[2], skills, 2)).toEqual({ ok: false, reason: 'limit' })
    expect(canActivate(skills[2], skills, 3)).toEqual({ ok: true })
  })

  it('ロック中・達成済み・挑戦中は挑戦にできない', () => {
    const skills = [skill('a', [], 'done'), skill('b', ['x']), skill('c', [], 'active')]
    expect(canActivate(skills[0], skills, 3)).toEqual({ ok: false, reason: 'done' })
    expect(canActivate(skills[1], skills, 3)).toEqual({ ok: false, reason: 'locked' })
    expect(canActivate(skills[2], skills, 3)).toEqual({ ok: false, reason: 'already' })
  })
})

describe('newlyUnlocked', () => {
  it('ほかの前提も満たしているものだけを返す', () => {
    const skills = [skill('a'), skill('b', [], 'done'), skill('c', ['a', 'b']), skill('d', ['a', 'x']), skill('e', ['b'])]
    expect(newlyUnlocked('a', skills).map((s) => s.id)).toEqual(['c'])
  })
})

describe('invalidActives', () => {
  it('前提が崩れた挑戦中スキルを返す', () => {
    const skills = [skill('a'), skill('b', ['a'], 'active'), skill('c', [], 'active')]
    expect(invalidActives(skills).map((s) => s.id)).toEqual(['b'])
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

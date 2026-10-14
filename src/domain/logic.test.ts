import { describe, expect, it } from 'vitest'
import {
  canAchieve,
  computeStates,
  descendants,
  indexById,
  newlyUnlocked,
  practicingFrom,
  practiceOrder,
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
  it('前提がすべて達成済みならおすすめ、そうでなければその先。最近記録した型は練習中', () => {
    const skills = [skill('a', [], 'done'), skill('b', ['a']), skill('c', ['a', 'b']), skill('d')]
    const states = computeStates(skills, new Set(['d']))
    expect(states.get('a')).toBe('done')
    expect(states.get('b')).toBe('available')
    expect(states.get('c')).toBe('locked')
    expect(states.get('d')).toBe('active')
  })

  it('前提を練習中なら並行して練習できるが、達成は前提を達成してから', () => {
    const skills = [skill('steam'), skill('dot', ['steam']), skill('heart', ['dot'])]
    const states = computeStates(skills, new Set(['steam']))
    expect(states.get('dot')).toBe('available')
    expect(states.get('heart')).toBe('locked')
    const byId = indexById(skills)
    expect(canAchieve(skills[1], byId)).toBe(false)
    expect(canAchieve(skills[0], byId)).toBe(true)

    // ドットも記録すると（練習中）、ハートも並行して練習できる
    expect(computeStates(skills, new Set(['steam', 'dot'])).get('heart')).toBe('available')
  })

  it('「できた」の型は、最近記録していても「できた」', () => {
    expect(computeStates([skill('a', [], 'done')], new Set(['a'])).get('a')).toBe('done')
  })
})

describe('practicingFrom', () => {
  it('最近の記録の型。無ければ、最後に記録した型', () => {
    expect([...practicingFrom([{ skillId: 'a' }, { skillId: 'b' }, { skillId: 'a' }], undefined)]).toEqual(['a', 'b'])
    expect([...practicingFrom([], { skillId: 'z' })]).toEqual(['z'])
    expect([...practicingFrom([], undefined)]).toEqual([])
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

describe('practiceOrder', () => {
  it('最近練習した順に並べる', () => {
    const items = [
      { id: 'a', last: 1 },
      { id: 'b', last: 3 },
      { id: 'c', last: 2 },
    ]
    expect(practiceOrder(items, (x) => x.last).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })
})

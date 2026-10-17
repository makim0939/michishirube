import { describe, expect, it } from 'vitest'
import {
  computeStates,
  descendants,
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
    references: [],
    prereqIds,
    status,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('computeStates', () => {
  it('前提のどれか1つが達成済みならおすすめ、どれもまだならその先。最近記録した型は練習中', () => {
    const skills = [skill('a', [], 'done'), skill('b', ['a']), skill('c', ['b']), skill('d'), skill('e', ['a', 'c'])]
    const states = computeStates(skills, new Set(['d']))
    expect(states.get('a')).toBe('done')
    expect(states.get('b')).toBe('available')
    expect(states.get('c')).toBe('locked')
    expect(states.get('d')).toBe('active')
    // 前提が複数でも、どれか1つ（a）が達成済みなら、もう先ではない
    expect(states.get('e')).toBe('available')
  })

  it('前提が無い型は、最初からおすすめ', () => {
    expect(computeStates([skill('a')], new Set()).get('a')).toBe('available')
  })

  it('前提を練習中なら並行して練習できる', () => {
    const skills = [skill('steam'), skill('dot', ['steam']), skill('heart', ['dot'])]
    const states = computeStates(skills, new Set(['steam']))
    expect(states.get('dot')).toBe('available')
    expect(states.get('heart')).toBe('locked')

    // ドットも記録すると（練習中）、ハートも並行して練習できる
    expect(computeStates(skills, new Set(['steam', 'dot'])).get('heart')).toBe('available')
  })

  it('前提が複数のとき、どれか1つが練習中なら並行して練習できる（もう一方が未着手でも）', () => {
    const skills = [skill('wing-tulip'), skill('wing-heart'), skill('swan', ['wing-tulip', 'wing-heart'])]
    expect(computeStates(skills, new Set()).get('swan')).toBe('locked')
    expect(computeStates(skills, new Set(['wing-heart'])).get('swan')).toBe('available')
    expect(computeStates(skills, new Set(['wing-tulip'])).get('swan')).toBe('available')
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
  it('はじめて前提を満たしたものだけを返す（別の前提を先に達成していた型は、もう満たしていた）', () => {
    const skills = [skill('a'), skill('b', [], 'done'), skill('c', ['a', 'b']), skill('d', ['a', 'x']), skill('e', ['b'])]
    expect(newlyUnlocked('a', skills).map((s) => s.id)).toEqual(['d'])
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

  it('前提が複数あるときは、いちばん短い経路の深さで並べる', () => {
    // swan は、長い道（wing-heart 経由）より、短い道（wing-tulip 経由）の深さ
    const skills = [
      skill('swan', ['wing-tulip', 'wing-heart']),
      skill('wing-heart', ['layer-heart']),
      skill('layer-heart', ['rosetta']),
      skill('wing-tulip', ['rosetta']),
      skill('rosetta'),
    ]
    expect(sortByDepth(skills).map((s) => s.id)).toEqual(['rosetta', 'layer-heart', 'wing-tulip', 'swan', 'wing-heart'])
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

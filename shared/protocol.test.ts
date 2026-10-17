import { describe, expect, it } from 'vitest'
import { withoutLegacySkillFields } from './protocol'

describe('withoutLegacySkillFields', () => {
  it('参考の目安と出典だけを除いたコピーを返し、元は変えない', () => {
    const row = { id: 's1', name: 'ハート', description: '説明', criteria: '10回中8回', sources: [{ title: 't' }] }
    expect(withoutLegacySkillFields(row)).toEqual({ id: 's1', name: 'ハート', description: '説明' })
    expect(row.criteria).toBe('10回中8回')
  })
})

import { describe, expect, it } from 'vitest'
import { parseGuide } from './guide'

describe('描き方ガイド', () => {
  it('ラベル付きの行と※の行をコツ・目安に分ける', () => {
    const guide = parseGuide(
      'ドットを大きく育てて切る。\n練習法：水で注ぐ。\n目安：1週間ほど。\n\n※回数の基準はない。\n2段落目の説明。',
    )
    expect(guide.body).toEqual(['ドットを大きく育てて切る。', '2段落目の説明。'])
    expect(guide.tips).toEqual([
      { label: '練習法', text: '水で注ぐ。' },
      { label: '目安', text: '1週間ほど。' },
      { text: '回数の基準はない。' },
    ])
  })

  it('ラベルが無ければ、すべてやり方', () => {
    expect(parseGuide('注ぐ。切る。')).toEqual({ body: ['注ぐ。切る。'], tips: [] })
  })
})

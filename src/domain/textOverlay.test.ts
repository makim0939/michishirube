import { describe, expect, it } from 'vitest'
import { applyStyle, clampRange, currentStyle, fontCss, TEXT_FONTS, TEXT_STYLES, fitAll, fitFrom, fitTo, lanes, moveEnd, moveStart, newText, outputIntervals, snapCenter, TEXT_MIN_SECONDS, wrapLines, type TextOverlay } from './textOverlay'

const base = (over: Partial<TextOverlay> = {}): TextOverlay => ({
  id: 'x',
  key: 'a',
  start: 2,
  end: 5,
  text: 'こんにちは',
  x: 0.5,
  y: 0.78,
  size: 0.055,
  color: '#ffffff',
  stroke: '#1d1712',
  font: 'gothic',
  plate: false,
  plateColor: '#1d1712',
  ...over,
})

describe('テキストを置く', () => {
  it('再生ヘッドの位置から 3 秒、表示する', () => {
    const o = newText('a', 4, 20)
    expect([o.start, o.end]).toEqual([4, 7])
  })

  it('動画の終わりまで 3 秒なければ、終わりに収まるよう手前に寄せる', () => {
    const o = newText('a', 19, 20)
    expect(o.end).toBe(20)
    expect(o.end - o.start).toBe(3)
  })

  it('はじめは、ゴシックで、白い字幕（縁取りなし・影だけ・板なし）', () => {
    const o = newText('a', 0, 10)
    expect([o.font, o.color, o.stroke, o.plate]).toEqual(['gothic', '#ffffff', null, false])
  })

  it('動画が 3 秒より短ければ、動画の長さまでにする', () => {
    const o = newText('a', 0.5, 2)
    expect([o.start, o.end]).toEqual([0, 2])
  })
})

describe('テキストの時間を動かす', () => {
  it('始めの端は、終わりより最小の長さ手前まで、動画の頭までしか動かせない', () => {
    expect(moveStart(base(), 10, 20).start).toBe(5 - TEXT_MIN_SECONDS)
    expect(moveStart(base(), -3, 20).start).toBe(0)
  })

  it('終わりの端は、始めより最小の長さ先から、動画の終わりまでしか動かせない', () => {
    expect(moveEnd(base(), 0, 20).end).toBe(2 + TEXT_MIN_SECONDS)
    expect(moveEnd(base(), 99, 20).end).toBe(20)
  })

  it('範囲を動画の中に収める', () => {
    expect(clampRange(18, 25, 20)).toEqual({ start: 18, end: 20 })
    expect(clampRange(-2, 1, 20).start).toBe(0)
  })
})

describe('表示する時間を、ひとことで合わせる', () => {
  it('全体：動画の始めから終わりまで', () => {
    expect(fitAll(base(), 20)).toMatchObject({ start: 0, end: 20 })
  })

  it('ここから最後まで：再生ヘッドから動画の終わりまで（終わりに近すぎれば、最小の長さを残す）', () => {
    expect(fitFrom(base(), 8, 20)).toMatchObject({ start: 8, end: 20 })
    expect(fitFrom(base(), 19.9, 20).start).toBe(20 - TEXT_MIN_SECONDS)
  })

  it('最初からここまで：動画の始めから再生ヘッドまで（始めに近すぎれば、最小の長さ）', () => {
    expect(fitTo(base(), 8, 20)).toMatchObject({ start: 0, end: 8 })
    expect(fitTo(base(), 0, 20).end).toBe(TEXT_MIN_SECONDS)
  })
})

describe('位置の吸い付き', () => {
  it('中央の近くは中央に、離れていればそのまま', () => {
    expect(snapCenter(0.51)).toBe(0.5)
    expect(snapCenter(0.45)).toBe(0.45)
  })
})

describe('できあがりの時間に直す', () => {
  const ranges = [
    { key: 'a', start: 0, end: 10 },
    { key: 'b', start: 3, end: 8 },
  ]

  it('動画の頭から残していれば、同じ時間になる', () => {
    expect(outputIntervals([base({ start: 2, end: 5 })], ranges)).toEqual([{ id: 'x', start: 2, end: 5 }])
  })

  it('頭を切ったぶん、早く出る', () => {
    expect(outputIntervals([base({ start: 4, end: 7 })], [{ key: 'a', start: 3, end: 10 }])).toEqual([{ id: 'x', start: 1, end: 4 }])
  })

  it('途中を外すと、そこで途切れて 2 つに分かれる', () => {
    const cut = [
      { key: 'a', start: 0, end: 4 },
      { key: 'a', start: 6, end: 10 },
    ]
    expect(outputIntervals([base({ start: 2, end: 8 })], cut)).toEqual([
      { id: 'x', start: 2, end: 4 },
      { id: 'x', start: 4, end: 6 },
    ])
  })

  it('外した区間の中だけにあるテキストは、できあがりに入らない', () => {
    expect(outputIntervals([base({ start: 4.5, end: 5.5 })], [{ key: 'a', start: 0, end: 4 }, { key: 'a', start: 6, end: 10 }])).toEqual([])
  })

  it('2 本目の動画のテキストは、1 本目の長さのあとに出る', () => {
    expect(outputIntervals([base({ key: 'b', start: 4, end: 6 })], ranges)).toEqual([{ id: 'x', start: 11, end: 13 }])
  })

  it('空のテキストは、重ねない', () => {
    expect(outputIntervals([base({ text: '  ' })], ranges)).toEqual([])
  })
})

describe('重なるテキストの段', () => {
  it('同じ時間に重なれば別の段、重ならなければ同じ段', () => {
    const a = base({ id: 'a', start: 0, end: 3 })
    const b = base({ id: 'b', start: 2, end: 5 })
    const c = base({ id: 'c', start: 3, end: 6 })
    expect(lanes([a, b, c], { a: 0 })).toEqual({ a: 0, b: 1, c: 0 })
  })
})

describe('折り返し', () => {
  const measure = (s: string) => Array.from(s).length * 10

  it('英単語は、途中で折らない（空白で折る）', () => {
    expect(wrapLines('cooking journaling and study', 150, measure)).toEqual(['cooking', 'journaling and', 'study'])
  })

  it('1 行に入らない長い英単語だけは、文字で折る', () => {
    expect(wrapLines('abcdefghijkl', 50, measure)).toEqual(['abcde', 'fghij', 'kl'])
  })

  it('日本語と英語が混ざっても、日本語は 1 文字ずつ、英語は単語ごと', () => {
    expect(wrapLines('ラテ art です', 60, measure)).toEqual(['ラテ art', 'です'])
  })

  it('改行で分ける', () => {
    expect(wrapLines('ab\ncd', 100, measure)).toEqual(['ab', 'cd'])
  })

  it('幅を超えたら、文字ごとに折り返す', () => {
    expect(wrapLines('あいうえおかき', 30, measure)).toEqual(['あいう', 'えおか', 'き'])
  })
})

describe('スタイル（1 タップで、色・縁取り・板をまとめて決める）', () => {
  it('当てても、位置・時間・文字・大きさ・フォントは変わらない', () => {
    const o = base({ x: 0.3, y: 0.4, size: 0.08, font: 'maru', text: 'ラテ' })
    const next = applyStyle(o, 'accent')
    expect(next).toMatchObject({ x: 0.3, y: 0.4, size: 0.08, font: 'maru', text: 'ラテ', start: 2, end: 5, color: '#ffd84d', stroke: '#2b1d14', plate: false })
  })

  it('板つきは、縁取りなしで板が付く', () => {
    expect(applyStyle(base(), 'plate-dark')).toMatchObject({ stroke: null, plate: true, plateColor: '#2b1d14' })
  })

  it('いまのスタイルが分かる。細かく色を変えたら、どれにも当たらない', () => {
    expect(currentStyle(applyStyle(base(), 'outline'))).toBe('outline')
    expect(currentStyle({ ...applyStyle(base(), 'outline'), color: '#123456' })).toBeUndefined()
  })

  it('スタイルは 6 つ、どれも別の見た目', () => {
    expect(TEXT_STYLES).toHaveLength(6)
    const keys = new Set(TEXT_STYLES.map((s) => `${s.color}|${s.stroke}|${s.plate}`))
    expect(keys.size).toBe(6)
  })
})

describe('フォント', () => {
  it('役割の違う 7 種で、字間・大文字・斜体は、それぞれのフォントが持つ', () => {
    expect(TEXT_FONTS.map((f) => f.id)).toEqual(['gothic', 'maru', 'mincho', 'hand', 'serif', 'serifi', 'wide'])
    const wide = TEXT_FONTS.find((f) => f.id === 'wide')!
    expect([wide.upper, wide.tracking > 0]).toEqual([true, true])
    expect(TEXT_FONTS.find((f) => f.id === 'serifi')!.italic).toBe(true)
  })

  it('canvas の font 指定に、斜体・太さ・大きさ・フォントが入る', () => {
    expect(fontCss('serifi', 40)).toMatch(/^italic 500 40px "Playfair Display"/)
    expect(fontCss('gothic', 20)).toMatch(/^600 20px "Hiragino Sans"/)
  })

  it('セリフ・細字は、日本語のために、後ろの候補に標準の明朝・ゴシックを持つ（英字だけのフォントのため）', () => {
    expect(TEXT_FONTS.find((f) => f.id === 'serif')!.family).toContain('Hiragino Mincho ProN')
    expect(TEXT_FONTS.find((f) => f.id === 'wide')!.family).toContain('Hiragino Sans')
  })
})

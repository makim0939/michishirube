import { t } from '../i18n'

/**
 * 「窓辺のラテ工房」の描き起こした素材（public/world）への道筋。
 * 主役はいつも利用者が撮った写真で、これらは写真がまだ無いところや型の見本にだけ使う
 */

const base = import.meta.env.BASE_URL

export type Pattern =
  | 'plain'
  | 'dot'
  | 'heart'
  | 'tulip2'
  | 'tulip3'
  | 'tulip4'
  | 'rosetta'
  | 'wing'
  | 'wingheart'
  | 'swan'
  | 'layerheart'

/**
 * 型の名前から見本の絵を選ぶ。テンプレートのキーはデータに残らないので名前で判定する。
 * 見本の無い型（自分で作った分野など）は undefined
 */
export function patternFor(name: string): Pattern | undefined {
  const n = name.normalize('NFKC')
  return patternForJa(n) ?? patternForEn(n.toLowerCase())
}

function patternForJa(n: string): Pattern | undefined {
  if (n.includes('スチーム')) return 'plain'
  if (n.includes('ドット')) return 'dot'
  if (n.includes('レイヤーハート')) return 'layerheart'
  if (n.includes('スワン')) return 'swan'
  // 「ウィングハート」は、ウィングチューリップの絵にならないよう、先に判定する
  if (n.includes('ウィングハート') || n.includes('ウイングハート')) return 'wingheart'
  if (n.includes('ウイング') || n.includes('ウィング')) return 'wing'
  if (n.includes('ロゼッタ') || n.includes('リーフ')) return 'rosetta'
  // ウェーブ（スタックドチューリップ）は層を重ねたチューリップなので、層の多い絵を使う
  if (n.includes('ウェーブ') || n.includes('スタック')) return 'tulip4'
  if (n.includes('チューリップ')) {
    if (/[3３]段|三段/.test(n)) return 'tulip3'
    if (/[4４]段|四段/.test(n)) return 'tulip4'
    // 「チューリップ」だけなら、基本の2段の絵にする
    return 'tulip2'
  }
  if (n.includes('ハート')) return 'heart'
  return undefined
}

/** 英語の名前（同梱の英語の型と、自分で付けた名前）。判定の順は日本語と同じ */
function patternForEn(n: string): Pattern | undefined {
  if (n.includes('steam') || n.includes('microfoam')) return 'plain'
  if (/\bdots?\b/.test(n)) return 'dot'
  if (n.includes('layered heart') || n.includes('layer heart')) return 'layerheart'
  if (n.includes('swan')) return 'swan'
  if (n.includes('wing heart') || n.includes('winged heart')) return 'wingheart'
  if (n.includes('wing')) return 'wing'
  if (n.includes('rosetta') || n.includes('leaf')) return 'rosetta'
  if (n.includes('wave') || n.includes('stacked')) return 'tulip4'
  if (n.includes('tulip')) {
    if (/\b(3|three)[- ]?(tier|stack|layer)/.test(n)) return 'tulip3'
    if (/\b(4|four)[- ]?(tier|stack|layer)/.test(n)) return 'tulip4'
    return 'tulip2'
  }
  if (n.includes('heart')) return 'heart'
  return undefined
}

export function patternUrl(p: Pattern): string {
  return `${base}world/patterns/${p}.webp`
}

export type Light = 'morning' | 'noon' | 'evening' | 'night'

/** 開いた時刻の光。窓辺の光は時間で変わる */
export function lightFor(date = new Date()): Light {
  const h = date.getHours()
  if (h >= 5 && h < 10) return 'morning'
  if (h >= 10 && h < 16) return 'noon'
  if (h >= 16 && h < 19) return 'evening'
  return 'night'
}

export const LIGHT_LABEL: Record<Light, string> = t.light

export function lightUrl(l: Light): string {
  return `${base}world/light/${l}.webp`
}

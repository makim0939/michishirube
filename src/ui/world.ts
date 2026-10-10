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
  | 'swan'
  | 'layerheart'

/**
 * 型の名前から見本の絵を選ぶ。テンプレートのキーはデータに残らないので名前で判定する。
 * 見本の無い型（自分で作った分野など）は undefined
 */
export function patternFor(name: string): Pattern | undefined {
  const n = name.normalize('NFKC')
  if (n.includes('スチーム')) return 'plain'
  if (n.includes('ドット')) return 'dot'
  if (n.includes('レイヤーハート')) return 'layerheart'
  if (n.includes('スワン')) return 'swan'
  if (n.includes('ウイング') || n.includes('ウィング')) return 'wing'
  if (n.includes('ロゼッタ') || n.includes('リーフ')) return 'rosetta'
  // ウェーブ（スタックドチューリップ）は層を重ねたチューリップなので、層の多い絵を使う
  if (n.includes('ウェーブ') || n.includes('スタック')) return 'tulip4'
  if (n.includes('チューリップ')) {
    if (/[3３]段|三段/.test(n)) return 'tulip3'
    if (/[4４]段|四段/.test(n)) return 'tulip4'
    // 「ハート・チューリップを連続で…」のような練習もチューリップの絵にする
    return 'tulip2'
  }
  if (n.includes('ハート')) return 'heart'
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

export const LIGHT_LABEL: Record<Light, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  night: '夜',
}

export function lightUrl(l: Light): string {
  return `${base}world/light/${l}.webp`
}

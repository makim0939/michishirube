/**
 * 型の説明を、描き方ガイドの「やり方」と「コツ・目安」に分ける。
 * 「練習法：」「目安：」などで始まる行と「※」の行はコツ・目安に、それ以外はやり方にする
 */

export interface GuideTip {
  /** 練習法・目安・参考など。無ければ補足 */
  label?: string
  text: string
}

export interface Guide {
  body: string[]
  tips: GuideTip[]
}

const LABELED = /^(練習法|目安|参考|コツ|注意)[：:]\s*(.+)$/

export function parseGuide(description: string): Guide {
  const body: string[] = []
  const tips: GuideTip[] = []
  for (const raw of description.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const labeled = LABELED.exec(line)
    if (labeled) tips.push({ label: labeled[1], text: labeled[2] })
    else if (line.startsWith('※')) tips.push({ text: line.slice(1).trim() })
    else body.push(line)
  }
  return { body, tips }
}

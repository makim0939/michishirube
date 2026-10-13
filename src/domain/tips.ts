import type { PracticeRecord } from './types'

/**
 * 型ごとの「自分のコツ」。自分の記録から、注ぐ前に読み返したいことをまとめる
 * （一般的な説明ではなく、自分が書いた次の一手・選んだ原因・うまくいったときのメモ）
 */
export interface Tips {
  /** いま意識していること（いちばん新しい次の一手） */
  focus?: { text: string; at: number }
  /** つまずきやすいところ（直近の△✕で選んだ原因と、その回数。多い順） */
  stumbles: { cause: string; count: number }[]
  /** 直近で原因を数えた杯の数 */
  window: number
  /** うまくいったときのメモ（◎の杯のメモ。新しい順） */
  wins: { recordId: string; text: string; at: number }[]
}

/** records は新しい順 */
export function summarizeTips(records: PracticeRecord[], { window = 10, wins = 3 } = {}): Tips {
  const hit = records.find((r) => r.nextAction.trim())
  const recent = records.slice(0, window)
  const counts = new Map<string, number>()
  for (const r of recent) {
    if (r.outcome !== 'meh' && r.outcome !== 'bad') continue
    for (const c of r.causes ?? []) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return {
    focus: hit && { text: hit.nextAction.trim(), at: hit.createdAt },
    stumbles: [...counts]
      .map(([cause, count]) => ({ cause, count }))
      // 同じ回数なら、名前の順にして並びを安定させる
      .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause, 'ja')),
    window: recent.length,
    wins: records
      .filter((r) => r.outcome === 'good' && r.reason.trim())
      .slice(0, wins)
      .map((r) => ({ recordId: r.id, text: r.reason.trim(), at: r.createdAt })),
  }
}

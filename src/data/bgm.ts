/**
 * BGM。アプリに同梱する曲（CC0・自作だけ。docs/bgm.md）と、利用者が端末のファイルから選ぶ曲。
 * YouTube オーディオライブラリの曲は、同梱せず、利用者が Studio からダウンロードして、ファイルから選ぶ
 * （同梱は再配布にあたり、許可の根拠が無いため）
 */

export interface BgmTrack {
  id: string
  /** 画面に出す名前 */
  title: string
  /** public/bgm/ の中の場所（例：bgm/morning.m4a） */
  path: string
  /** 繰り返しの 1 回分の長さ（秒。一覧に出す。scripts/make-bgm.py が出した値） */
  seconds: number
}

/** 同梱の曲（一覧の並び順）。曲を足す・差し替えるときは docs/bgm.md の手順で、public/bgm/ に置き、ここに足す */
export const BUNDLED_BGM: BgmTrack[] = [
  { id: 'dreams-of-tomorrow', title: 'Dreams of Tomorrow', path: 'bgm/dreams-of-tomorrow.m4a', seconds: 25.7 },
  { id: 'playful-toy', title: 'Playful Toy', path: 'bgm/playful-toy.m4a', seconds: 22 },
  { id: 'cosy-feeling', title: 'Cosy Feeling', path: 'bgm/cosy-feeling.m4a', seconds: 36.5 },
  { id: 'quiet-days', title: 'Quiet Days', path: 'bgm/quiet-days.m4a', seconds: 24 },
  { id: '8bit-bossa', title: '8bit Bossa', path: 'bgm/8bit-bossa.m4a', seconds: 56.8 },
  { id: 'april-groove', title: 'April Groove', path: 'bgm/april-groove.m4a', seconds: 28.7 },
]

/** 選んだ BGM。同梱の曲か、利用者のファイル */
export type BgmChoice = { kind: 'bundled'; track: BgmTrack } | { kind: 'file'; file: File }

export function bgmTitle(choice: BgmChoice): string {
  return choice.kind === 'bundled' ? choice.track.title : choice.file.name.replace(/\.[^.]+$/, '')
}

/** 拡張子（小文字。m4a・mp3 など）。無ければ m4a */
export function bgmExtension(choice: BgmChoice): string {
  const name = choice.kind === 'bundled' ? choice.track.path : choice.file.name
  const ext = /\.([A-Za-z0-9]{2,4})$/.exec(name)?.[1]?.toLowerCase()
  return ext ?? 'm4a'
}

/** 音声の中身。同梱の曲は、アプリの中から読む */
export async function bgmBlob(choice: BgmChoice): Promise<Blob> {
  if (choice.kind === 'file') return choice.file
  const res = await fetch(`${import.meta.env.BASE_URL}${choice.track.path}`)
  // iPhone のアプリは、音声・動画のファイルを HTTP でない応答で返すので、成功でも status が 0 になる（ok が false）
  if (res.status !== 0 && !res.ok) throw new Error(`BGM を読めません（${res.status}）`)
  const blob = await res.blob()
  if (blob.size === 0) throw new Error('BGM を読めません（空のファイル）')
  return blob
}

/** 一覧に出す長さ（0:26 の形） */
export function formatSeconds(sec: number): string {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

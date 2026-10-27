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
}

/** 同梱の曲。曲を足すときは、public/bgm/ に置き、ここに足し、出典とライセンスを docs/bgm.md に書く */
export const BUNDLED_BGM: BgmTrack[] = []

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

import { db } from './db'

/**
 * 動画の保存先。端末ごとの設定（端末の空き容量は端末ごとに違うので、同期しない）。
 * - device：端末にだけ置き、消さない。YouTube には上げない
 * - youtube：YouTube（限定公開）に上げ、しばらくしたら端末から消す。消したあとはアプリの中で YouTube から再生する
 */
export type VideoStorage = 'device' | 'youtube'

const KEY = 'videoStorage'

/**
 * 今の保存先。まだ選んでいなければ、YouTube に上げた動画がある端末は youtube（前からの使い方を続ける）、
 * それ以外は device。読むだけなので、liveQuery の中でも使える
 */
export async function getVideoStorage(): Promise<VideoStorage> {
  const saved = (await db.meta.get(KEY))?.value as VideoStorage | undefined
  if (saved) return saved
  const uploaded = await db.media.filter((m) => !!m.youtubeId).first()
  return uploaded ? 'youtube' : 'device'
}

export async function setVideoStorage(value: VideoStorage) {
  await db.meta.put({ key: KEY, value })
}

/** 起動時に、まだ選んでいなければ今の保存先を覚える（あとから動画が増えて、選び直されないように） */
export async function ensureVideoStorage(): Promise<VideoStorage> {
  const value = await getVideoStorage()
  if (!(await db.meta.get(KEY))) await setVideoStorage(value)
  return value
}

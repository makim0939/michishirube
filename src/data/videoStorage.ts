import { db } from './db'

/**
 * 動画の保存先。端末ごとの設定（端末の空き容量は端末ごとに違うので、同期しない）。
 * - device：端末にだけ置き、消さない。YouTube には上げない
 * - youtube：YouTube（限定公開）に上げ、しばらくしたら端末から消す。消したあとはアプリの中で YouTube から再生する
 */
export type VideoStorage = 'device' | 'youtube'

const KEY = 'videoStorage'

/**
 * 今の保存先。まだ選んでいなければ、YouTube に上げた動画がある端末は youtube（前からの使い方を続ける・入れ直した端末で戻す）、
 * それ以外は device。読むだけなので、liveQuery の中でも使える
 */
export async function getVideoStorage(): Promise<VideoStorage> {
  const saved = (await db.meta.get(KEY))?.value as VideoStorage | undefined
  if (saved) return saved
  // 上げ終えた動画が1つでもあるか。中身（動画）を読まないよう、キーだけを見る
  const uploaded = await db.media.where('upload').equals('done').limit(1).primaryKeys()
  return uploaded.length > 0 ? 'youtube' : 'device'
}

export async function setVideoStorage(value: VideoStorage) {
  await db.meta.put({ key: KEY, value })
}

import { db } from './db'

/**
 * 動画の保存先・画質。端末ごとの設定（端末の空き容量は端末ごとに違うので、同期しない）。
 * - device：端末にだけ置き、消さない。YouTube には上げない
 * - youtube：YouTube に上げ、しばらくしたら端末から消す。消したあとはアプリの中で YouTube から再生する
 */
export type VideoStorage = 'device' | 'youtube'

/**
 * 画質。standard は 720p で軽い（30秒で約5MB）。high は 1080p（30秒で約23MB）で、SNS に出しても見劣りしない。
 * アルバム・標準のカメラの動画も、アプリではこの画質にそろえる
 */
export type VideoQuality = 'standard' | 'high'

/** YouTube に上げるときの公開範囲。unlisted は URL を知っている人だけ、public はだれでも（検索にも出る） */
export type YoutubePrivacy = 'unlisted' | 'public'

export interface VideoSettings {
  storage: VideoStorage
  quality: VideoQuality
  /** 高画質で端末に置くとき、日がたっても高画質のまま残す（false なら、しばらくしたら標準に軽くする） */
  keepHigh: boolean
  youtubePrivacy: YoutubePrivacy
}

const KEY = 'videoStorage'
const QUALITY_KEY = 'videoQuality'
const KEEP_HIGH_KEY = 'videoKeepHigh'
const PRIVACY_KEY = 'youtubePrivacy'

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

/** 動画の設定をまとめて読む。読むだけなので、liveQuery の中でも使える */
export async function getVideoSettings(): Promise<VideoSettings> {
  const [storage, quality, keepHigh, privacy] = await Promise.all([
    getVideoStorage(),
    db.meta.get(QUALITY_KEY),
    db.meta.get(KEEP_HIGH_KEY),
    db.meta.get(PRIVACY_KEY),
  ])
  return {
    storage,
    quality: quality?.value === 'high' ? 'high' : 'standard',
    keepHigh: keepHigh?.value === true,
    youtubePrivacy: privacy?.value === 'public' ? 'public' : 'unlisted',
  }
}

export async function setVideoQuality(value: VideoQuality) {
  await db.meta.put({ key: QUALITY_KEY, value })
}

export async function setKeepHigh(value: boolean) {
  await db.meta.put({ key: KEEP_HIGH_KEY, value })
}

export async function setYoutubePrivacy(value: YoutubePrivacy) {
  await db.meta.put({ key: PRIVACY_KEY, value })
}

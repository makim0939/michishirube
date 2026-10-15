/** 分野（ピアノ、ラテアートなど）。1つの分野が1枚のロードマップになる */
export interface Domain {
  id: string
  name: string
  order: number
  createdAt: number
  /** 最後に変更した時刻。端末間で同期するとき、新しいほうを残す */
  updatedAt: number
}

export interface Source {
  title: string
  url?: string
}

/** 練習中に何度も見返す動画や記事 */
export interface Reference {
  id: string
  title: string
  url: string
  /** 「2:30から」「注ぎ始めの高さ」など、見るところのメモ */
  note?: string
}

/**
 * 保存する状態。練習中・locked・available は、記録と前提条件から導出するので保存しない。
 * 'active' は、前に「はじめる」で練習中にしていたころの値。今は書かず、読んでも使わない（同期で届く古いデータのために残す）
 */
export type SkillStatus = 'idle' | 'active' | 'done'

/** 画面に出す状態 */
export type SkillState = 'locked' | 'available' | 'active' | 'done'

export interface Skill {
  id: string
  domainId: string
  name: string
  description: string
  /** 達成条件。「10回中8回」のように判定できる書き方にする */
  criteria: string
  sources: Source[]
  references: Reference[]
  prereqIds: string[]
  status: SkillStatus
  /** 前に「はじめる」で練習中にした日時。今は使わない（古いデータのために残す） */
  activatedAt?: number
  achievedAt?: number
  createdAt: number
  updatedAt: number
}

export type Outcome = 'good' | 'meh' | 'bad'

export interface PracticeRecord {
  id: string
  skillId: string
  createdAt: number
  updatedAt: number
  outcome?: Outcome
  /** うまくいった／いかなかった理由 */
  reason: string
  /** うまくいかなかった原因（ワンタップで選んだもの） */
  causes?: string[]
  /** 次に試すこと。次回の記録画面の一番上に出る */
  nextAction: string
  mediaIds: string[]
}

export type UploadState = 'pending' | 'uploading' | 'done' | 'failed'

export interface Media {
  id: string
  recordId: string
  skillId: string
  /** 中身。この端末にだけある（同期しない）。整理したり別の端末だったりすると無い */
  blob?: Blob
  /**
   * アプリ（iOS・Android）では、中身を blob ではなくアプリのファイルに置き、その場所を持つ（同期しない）。
   * どちらにあるかは hasContent()、中身は contentBlob() で扱う
   */
  file?: string
  /**
   * アプリで、ファイルの動画をどの画質にそろえたか（同期しない）。まだなら undefined。
   * アルバムの大きな動画や、日がたった高画質の動画を軽くするときに使う
   */
  optimized?: 'standard' | 'high'
  /** 画質をそろえようとして失敗した回数（同期しない）。何度か失敗したら、元のまま使う */
  optimizeTries?: number
  /** 動画のサムネイル（JPEG）。この端末にだけある */
  poster?: Blob
  /** poster が動画の最後のコマ（できあがりのカップ）か。この端末にだけある（同期しない） */
  posterEnd?: boolean
  type: string
  name?: string
  size: number
  createdAt: number
  updatedAt: number
  /** 以前の「端末に残す」印。今は使わない（同期で届く古いデータに残っていることがある） */
  keep?: boolean
  /** 動画を YouTube に上げた結果 */
  upload?: UploadState
  uploadError?: string
  /** 続けて失敗した回数。上限に達したら、手で再試行するまで上げない */
  uploadAttempts?: number
  youtubeId?: string
  /** 写真をサーバーに置いた */
  cloudPhoto?: boolean
  /** 動画のサムネイルをサーバーに置いた（端末から動画が消えても、別の端末でもサムネイルを出せる） */
  cloudPoster?: boolean
  /** サーバーに置いたサムネイルが、動画の最後のコマか */
  cloudPosterEnd?: boolean
  /** 中身（動画・写真）を入れた・差し替えた日時。端末ごとに中身が食い違ったとき、新しいほうを残すのに使う */
  contentAt?: number
}

/** 端末をまたいで同期する設定。今は持つ項目が無い（練習中の上限はやめた。動画の保存先は端末ごと） */
export interface Settings {
  updatedAt: number
}

export const DEFAULT_SETTINGS: Settings = { updatedAt: 0 }

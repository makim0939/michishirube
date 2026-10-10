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

/** 保存する状態。locked / available は前提条件から導出するので保存しない */
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
  /** 動画の一覧に出すサムネイル（JPEG）。この端末にだけある */
  poster?: Blob
  type: string
  name?: string
  size: number
  createdAt: number
  updatedAt: number
  /** 自動整理で端末から消さない */
  keep?: boolean
  /** 動画を YouTube に上げた結果 */
  upload?: UploadState
  uploadError?: string
  /** 続けて失敗した回数。上限に達したら、手で再試行するまで上げない */
  uploadAttempts?: number
  youtubeId?: string
  /** 写真をサーバーに置いた */
  cloudPhoto?: boolean
}

export interface Settings {
  maxActive: number
  /** YouTube に上げ終えた古い動画を、端末から自動で消す */
  autoTidy: boolean
  updatedAt: number
}

export const DEFAULT_SETTINGS: Settings = { maxActive: 3, autoTidy: true, updatedAt: 0 }
export const MAX_ACTIVE_RANGE = { min: 1, max: 5 } as const

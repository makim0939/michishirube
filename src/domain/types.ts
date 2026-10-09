/** 分野（ピアノ、ラテアートなど）。1つの分野が1枚のロードマップになる */
export interface Domain {
  id: string
  name: string
  order: number
  createdAt: number
}

export interface Source {
  title: string
  url?: string
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
  prereqIds: string[]
  status: SkillStatus
  activatedAt?: number
  achievedAt?: number
  createdAt: number
}

export type Outcome = 'good' | 'meh' | 'bad'

export interface PracticeRecord {
  id: string
  skillId: string
  createdAt: number
  outcome?: Outcome
  /** うまくいった／いかなかった理由 */
  reason: string
  /** 次に試すこと。次回の記録画面の一番上に出る */
  nextAction: string
  mediaIds: string[]
}

export interface Media {
  id: string
  recordId: string
  skillId: string
  blob: Blob
  type: string
  name?: string
  size: number
  createdAt: number
}

export interface Settings {
  maxActive: number
}

export const DEFAULT_SETTINGS: Settings = { maxActive: 3 }
export const MAX_ACTIVE_RANGE = { min: 1, max: 5 } as const

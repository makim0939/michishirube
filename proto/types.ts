export type ConfirmMode = 'sheet' | 'undo'

export interface Range {
  start: number
  end: number
}

export interface ProtoProps {
  url: string
  dur: number
  mode: ConfirmMode
  /** できあがり（残す区間を並べた順）が変わるたびに */
  onRanges: (r: Range[]) => void
  onDone: () => void
  onDiscard: () => void
  onSoftClose: () => void
}

/** 細部の切り替え（?split=under|selected&delete=ripple|gap） */
export interface Variant {
  /** 分割・頭を切る・尻を切るが効く区間：再生ヘッドの下／選んだ区間 */
  split: 'under' | 'selected'
  /** 削除：消えて間が詰まる／斜線で残る */
  delete: 'ripple' | 'gap'
}

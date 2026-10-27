import type { ConfirmMode } from './Shell'

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

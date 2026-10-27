import { useState, type ReactNode } from 'react'

export type ConfirmMode = 'inline' | 'sheet' | 'undo'

/** どの案でも共通の外枠：上の「キャンセル／長さ／完了」と、変更があるときのキャンセルの確認 */
export function Shell({
  mode,
  dirty,
  length,
  onDone,
  onDiscard,
  onSoftClose,
  children,
}: {
  mode: ConfirmMode
  dirty: boolean
  length: string
  onDone: () => void
  onDiscard: () => void
  /** 確認を出さずに閉じる（「元に戻す」のトーストが、親に出る） */
  onSoftClose: () => void
  children: ReactNode
}) {
  const [asking, setAsking] = useState(false)
  const cancel = () => {
    if (!dirty) return onDiscard()
    if (mode === 'undo') onSoftClose()
    else setAsking(true)
  }
  return (
    <div className="p-shell">
      <div className="p-top">
        <button type="button" className="p-text" onClick={cancel}>
          キャンセル
        </button>
        <span className="p-length">{length}</span>
        <button type="button" className="p-text strong" onClick={onDone}>
          完了
        </button>
      </div>
      {children}
      {asking && mode === 'inline' && (
        <div className="confirm p-confirm-inline">
          <p>変更を破棄しますか</p>
          <div className="row">
            <button type="button" className="btn danger" onClick={onDiscard}>
              破棄する
            </button>
            <button type="button" className="btn ghost" onClick={() => setAsking(false)}>
              続ける
            </button>
          </div>
        </div>
      )}
      {asking && mode === 'sheet' && (
        <div className="p-backdrop" onClick={() => setAsking(false)}>
          <div className="p-sheet" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn danger block" onClick={onDiscard}>
              変更を破棄
            </button>
            <button type="button" className="btn block" onClick={() => setAsking(false)}>
              続ける
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

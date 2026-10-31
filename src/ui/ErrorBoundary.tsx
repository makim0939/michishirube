import { Component, type ReactNode } from 'react'
import { t } from '../i18n'
import { isChunkLoadError, reloadOnce } from './recover'

/** 読み込み直しても直らないときの、いちばん静かな画面。説明は並べず、ボタンを1つだけ出す */
export function RecoverScreen({ detail }: { detail?: string }) {
  return (
    <div className="screen recover">
      <button type="button" className="btn primary" onClick={() => window.location.reload()}>
        {t.app.reload}
      </button>
      {detail && <p className="muted">{detail}</p>}
    </div>
  )
}

interface Props {
  children: ReactNode
  /** 変わったら、エラーの表示をやめて描き直す（画面を移ったとき） */
  resetKey?: string
  /** 画面全体を覆うか（覆うなら、タブも含めて落ちた場合の最後の砦） */
  root?: boolean
}

interface State {
  error?: unknown
  /** 同じ画面で、自動で描き直した回数 */
  retries: number
}

/**
 * 描画中の例外で、画面全体が真っ白（タブも消える）になるのを防ぐ。
 * 1回目は黙って描き直し、それでも落ちるときだけ、読み込み直すボタンを出す。
 * 部品の読み込み失敗（デプロイ直後の古い画面）は、静かに読み込み直す
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { retries: 0 }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error }
  }

  componentDidCatch(error: unknown) {
    console.error('画面の描画で例外', error)
    if (isChunkLoadError(error) && reloadOnce()) return
    if (this.state.retries < 1) {
      // 一時的な状態の食い違いなら、描き直すだけで直る
      this.setState((s) => ({ error: undefined, retries: s.retries + 1 }))
    }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error !== undefined) {
      this.setState({ error: undefined, retries: 0 })
    }
  }

  render() {
    if (this.state.error !== undefined) {
      const message = this.state.error instanceof Error ? this.state.error.message : undefined
      return <RecoverScreen detail={this.props.root ? message : undefined} />
    }
    return this.props.children
  }
}

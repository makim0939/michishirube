import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Skill } from '../domain/types'
import { splitName } from './common'
import { go } from './router'
import { patternFor, patternUrl } from './world'

// ---- トースト ----

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastApi {
  /** action を渡すと、トーストにボタンを1つ出す（少し長く出す） */
  show: (message: string, tone?: 'ok' | 'error', action?: ToastAction) => void
}

const ToastContext = createContext<ToastApi>({ show: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

/** 例外を握りつぶさずトーストに出す */
export function useAction() {
  const toast = useToast()
  return useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn()
      } catch (e) {
        toast.show(e instanceof Error ? e.message : String(e), 'error')
        return undefined
      }
    },
    [toast],
  )
}

// ---- 達成の演出 ----

interface Celebration {
  skill: Skill
  unlocked: Skill[]
}

const CelebrationContext = createContext<(c: Celebration) => void>(() => {})

export function useCelebrate() {
  return useContext(CelebrationContext)
}

const CONFETTI_COLORS = ['#c99b66', '#8a5a34', '#e8d2b0', '#4f5a3a', '#faf7f2']

function CelebrationOverlay({
  celebration,
  onClose,
}: {
  celebration: Celebration
  onClose: () => void
}) {
  const { unlocked } = celebration
  const pattern = patternFor(celebration.skill.name)
  // 画面を移動したり Esc を押したら閉じる（スワイプで戻ったときに演出だけ残らないように）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('hashchange', onClose)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('hashchange', onClose)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.6 + Math.random() * 1.4,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotate: Math.random() * 360,
      })),
    [],
  )
  return (
    <div className="celebration" role="dialog" aria-modal="true" aria-labelledby="celebration-title">
      <div className="confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <span
            key={i}
            style={{
              left: `${p.left}%`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              transform: `rotate(${p.rotate}deg)`,
            }}
          />
        ))}
      </div>
      <div className="celebration-card">
        {pattern ? (
          <img className="celebration-badge" src={patternUrl(pattern)} alt="" />
        ) : (
          <div className="celebration-badge empty" aria-hidden="true" />
        )}
        <p className="celebration-kicker">できた</p>
        <h2 id="celebration-title">{splitName(celebration.skill.name).main}</h2>
        {unlocked.length > 0 ? (
          <div className="celebration-unlocked">
            <p>次のおすすめになった型</p>
            <ul>
              {unlocked.map((s) => (
                <li key={s.id}>{splitName(s.name).main}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">この型のあとに、新しくおすすめになる型はありません。</p>
        )}
        <div className="celebration-actions">
          {unlocked.length === 1 && (
            // 次の型は、記録すればそのまま練習中になる。押すとすぐカメラが開く
            <button className="btn primary" autoFocus onClick={() => go(`/record/${unlocked[0].id}`)}>
              「{splitName(unlocked[0].name).main}」を記録する
            </button>
          )}
          {unlocked.length > 1 && (
            <button className="btn primary" autoFocus onClick={() => go('/')}>
              次に練習する型を選ぶ
            </button>
          )}
          <button className="btn" autoFocus={unlocked.length === 0} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * トーストを出しておく時間。短い一言は2.5秒、エラーとボタン付きは5秒を下限に、
 * 長い文は読み終えられるよう文字数に応じて延ばす（上限は8秒。トーストは下の操作を邪魔しない）
 */
export function toastDuration(message: string, tone: 'ok' | 'error', hasAction: boolean): number {
  const floor = tone === 'error' || hasAction ? 5000 : 2500
  const reading = 1500 + message.length * 100
  return Math.min(Math.max(floor, reading), 8000)
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    message: string
    tone: 'ok' | 'error'
    action?: ToastAction
    key: number
  } | null>(null)
  const [celebration, setCelebration] = useState<Celebration | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toastDuration(toast.message, toast.tone, !!toast.action))
    return () => clearTimeout(timer)
  }, [toast])

  const closeCelebration = useCallback(() => setCelebration(null), [])
  const toastApi = useMemo<ToastApi>(
    () => ({ show: (message, tone = 'ok', action) => setToast({ message, tone, action, key: Date.now() }) }),
    [],
  )

  return (
    <ToastContext.Provider value={toastApi}>
      <CelebrationContext.Provider value={setCelebration}>
        {children}
        {toast && (
          <div key={toast.key} className={`toast ${toast.tone}${toast.action ? ' with-action' : ''}`} role="status">
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  setToast(null)
                  toast.action?.onClick()
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
        {celebration && (
          <CelebrationOverlay
            celebration={celebration}
            onClose={closeCelebration}
          />
        )}
      </CelebrationContext.Provider>
    </ToastContext.Provider>
  )
}

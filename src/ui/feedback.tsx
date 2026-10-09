import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Skill } from '../domain/types'
import { go } from './router'

// ---- トースト ----

interface ToastApi {
  show: (message: string, tone?: 'ok' | 'error') => void
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

const CONFETTI_COLORS = ['#f2b84b', '#1f6f5c', '#e0603f', '#5b8def', '#c86fc9']

function CelebrationOverlay({ celebration, onClose }: { celebration: Celebration; onClose: () => void }) {
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
        <div className="celebration-badge" aria-hidden="true">
          🏆
        </div>
        <p className="celebration-kicker">実績解除</p>
        <h2 id="celebration-title">{celebration.skill.name}</h2>
        {celebration.unlocked.length > 0 ? (
          <div className="celebration-unlocked">
            <p>新しく解放されたスキル</p>
            <ul>
              {celebration.unlocked.map((s) => (
                <li key={s.id}>🔓 {s.name}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">この道の先に、まだ解放されていないスキルはありません。</p>
        )}
        <div className="celebration-actions">
          {celebration.unlocked.length > 0 && (
            <button className="btn primary" autoFocus onClick={() => go(`/skill/${celebration.unlocked[0].id}`)}>
              次のスキルを見る
            </button>
          )}
          <button className="btn" autoFocus={celebration.unlocked.length === 0} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error'; key: number } | null>(null)
  const [celebration, setCelebration] = useState<Celebration | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.tone === 'error' ? 4000 : 2500)
    return () => clearTimeout(timer)
  }, [toast])

  const closeCelebration = useCallback(() => setCelebration(null), [])
  const toastApi = useMemo<ToastApi>(
    () => ({ show: (message, tone = 'ok') => setToast({ message, tone, key: Date.now() }) }),
    [],
  )

  return (
    <ToastContext.Provider value={toastApi}>
      <CelebrationContext.Provider value={setCelebration}>
        {children}
        {toast && (
          <div key={toast.key} className={`toast ${toast.tone}`} role="status">
            {toast.message}
          </div>
        )}
        {celebration && <CelebrationOverlay celebration={celebration} onClose={closeCelebration} />}
      </CelebrationContext.Provider>
    </ToastContext.Provider>
  )
}

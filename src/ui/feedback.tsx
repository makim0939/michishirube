import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { activateSkill } from '../data/repo'
import type { Skill } from '../domain/types'
import { splitName } from './common'
import { go } from './router'
import { patternFor, patternUrl } from './world'

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

const CONFETTI_COLORS = ['#c99b66', '#8a5a34', '#e8d2b0', '#4f5a3a', '#faf7f2']

function CelebrationOverlay({
  celebration,
  onClose,
  onError,
}: {
  celebration: Celebration
  onClose: () => void
  onError: (message: string) => void
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
            <p>次に目指せるようになった型</p>
            <ul>
              {unlocked.map((s) => (
                <li key={s.id}>{splitName(s.name).main}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">この型の先に、新しく開く型はありません。</p>
        )}
        <div className="celebration-actions">
          {unlocked.length === 1 && (
            <button
              className="btn primary"
              autoFocus
              onClick={async () => {
                try {
                  // 先取りで練習中なら、そのまま練習を続ける
                  if (unlocked[0].status !== 'active') await activateSkill(unlocked[0].id)
                  go('/')
                } catch (e) {
                  // 上限などで練習中にできなければ、型の画面で選んでもらう
                  onError(e instanceof Error ? e.message : String(e))
                  go(`/skill/${unlocked[0].id}`)
                }
              }}
            >
              {unlocked[0].status === 'active'
                ? `「${splitName(unlocked[0].name).main}」の練習を続ける`
                : `「${splitName(unlocked[0].name).main}」の練習を始める`}
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
        {celebration && (
          <CelebrationOverlay
            celebration={celebration}
            onClose={closeCelebration}
            onError={(message) => toastApi.show(message, 'error')}
          />
        )}
      </CelebrationContext.Provider>
    </ToastContext.Provider>
  )
}

import { buyPlus, FREE_COMPOSE_USES, restorePurchases } from '../data/purchases'
import { useToast } from './feedback'
import { useBackHandler } from './useBackHandler'
import { useProducts, usePurchaseRunner } from './SupportRows'
import { t } from '../i18n'

/**
 * 無料で試せる回数を使い切ったあと、「つなぐ」を押したときに出す、ラテ帳 Plus の購入の案内。
 * 画面の下から出すシート（型の選び直しと同じ）。説明は 1 行だけ。買う・復元する・閉じる（押し付けない：閉じれば、記録は今までどおり使える）
 */
export function PlusSheet({ onUnlocked, onClose }: { onUnlocked: () => void; onClose: () => void }) {
  const toast = useToast()
  const products = useProducts()
  const { busy, run } = usePurchaseRunner()
  useBackHandler(() => {
    if (!busy) onClose()
    return true
  })

  const buy = async () => {
    if (await run(buyPlus, t.support.plusThanks)) onUnlocked()
  }
  const restore = async () => {
    let restored = false
    const ok = await run(async () => {
      restored = await restorePurchases()
    })
    if (!ok) return
    if (restored) {
      toast.show(t.support.restored)
      onUnlocked()
    } else {
      toast.show(t.support.nothingToRestore)
    }
  }

  return (
    <div className="picker-backdrop" onClick={busy ? undefined : onClose}>
      <div className="picker-sheet" role="dialog" aria-modal="true" aria-label={t.support.plus} onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <h2>{t.support.plus}</h2>
          <button type="button" className="btn small" disabled={busy} onClick={onClose}>
            {t.common.close}
          </button>
        </div>
        <p className="muted small">{t.support.plusLine(FREE_COMPOSE_USES)}</p>
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !products.plus} onClick={() => void buy()}>
            {products.plus?.priceString ?? t.support.plus}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void restore()}>
            {t.support.restore}
          </button>
        </div>
      </div>
    </div>
  )
}

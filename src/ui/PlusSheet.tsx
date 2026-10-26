import { buyPlus, FREE_COMPOSE_USES, restorePurchases } from '../data/purchases'
import { useToast } from './feedback'
import { useBackHandler } from './useBackHandler'
import { useProducts, usePurchaseRunner } from './SupportRows'
import { t } from '../i18n'

/**
 * 無料で試せる回数を使い切ったあと、「つなぐ」を押したときに出す、ラテ帳 Plus の購入の案内。
 * 説明は 1 行だけ。買う・復元する・閉じる、の 3 つ（押し付けない：閉じれば、記録は今までどおり使える）
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
    <div className="confirm" role="dialog" aria-modal="true" aria-label={t.support.plus}>
      <p>
        <strong>{t.support.plus}</strong>
        <br />
        <span className="muted small">{t.support.plusLine(FREE_COMPOSE_USES)}</span>
      </p>
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !products.plus} onClick={() => void buy()}>
          {products.plus?.priceString ?? t.support.plus}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void restore()}>
          {t.support.restore}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
          {t.support.close}
        </button>
      </div>
    </div>
  )
}

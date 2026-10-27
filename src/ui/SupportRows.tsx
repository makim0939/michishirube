import { useEffect, useRef, useState } from 'react'
import type { Product } from '@capgo/native-purchases'
import {
  buyPlus,
  canPurchase,
  loadProducts,
  PurchaseCancelled,
  restorePurchases,
  sendTip,
  usePlus,
} from '../data/purchases'
import { useToast } from './feedback'
import { t } from '../i18n'

/**
 * 購入の操作を1つずつ行う。やめたときは何も出さず、失敗は、ストアの文ではなく、こちらの文で知らせる。
 * 続けて押されても、購入を二重に始めない（state は、次の描画まで変わらないため、別に持つ）
 */
export function usePurchaseRunner() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const run = async (task: () => Promise<void>, done?: string): Promise<boolean> => {
    if (running.current) return false
    running.current = true
    setBusy(true)
    try {
      await task()
      if (done) toast.show(done)
      return true
    } catch (e) {
      if (!(e instanceof PurchaseCancelled)) toast.show(t.support.failed, 'error')
      return false
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { busy, run }
}

/** 商品の情報を、ストアから取る（取れなければ空） */
export function useProducts() {
  const [products, setProducts] = useState<{ plus?: Product; tip?: Product }>({})
  useEffect(() => {
    if (canPurchase) void loadProducts().then(setProducts)
  }, [])
  return products
}

/**
 * 設定の「その他」に並べる、アプリ内課金の行（iPhone・iPad のアプリだけ）。
 * 説明は並べず、1行ずつ、押すとストアの購入の画面が出る。買ったかどうかは、行の右に出すだけ。
 * 価格はストアのもの。ストアから商品が取れた行だけを出す
 */
export function SupportRows() {
  const toast = useToast()
  const plus = usePlus()
  const products = useProducts()
  const { busy, run } = usePurchaseRunner()

  if (!canPurchase) return null

  const restore = () =>
    run(async () => {
      const restored = await restorePurchases()
      toast.show(restored ? t.support.restored : t.support.nothingToRestore)
    })

  return (
    <>
      {products.plus && (
        <>
          <li>
            <button
              type="button"
              className="settings-row choice"
              disabled={busy || plus}
              onClick={() => run(buyPlus, t.support.plusThanks)}
            >
              <span className="settings-label">{t.support.plus}</span>
              <span className="settings-value">{plus ? t.support.purchased : products.plus?.priceString}</span>
            </button>
          </li>
          <li>
            <button type="button" className="settings-row choice" disabled={busy} onClick={restore}>
              <span className="settings-label">{t.support.restore}</span>
            </button>
          </li>
        </>
      )}
      {/* 商品がストアに無い（まだ登録・承認されていない、取れなかった）ときは出さない。押しても必ず失敗する行を見せないため */}
      {products.tip && (
        <li>
          <button type="button" className="settings-row choice" disabled={busy} onClick={() => run(sendTip, t.support.tipThanks)}>
            <span className="settings-label">{t.support.tip}</span>
            <span className="settings-value">{products.tip.priceString}</span>
          </button>
        </li>
      )}
    </>
  )
}

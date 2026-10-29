import { useEffect, useRef, useState } from 'react'
import type { Product } from '@capgo/native-purchases'
import {
  canPurchase,
  loadProducts,
  PurchaseCancelled,
  sendTip,
  usePlus,
} from '../data/purchases'
import { useToast } from './feedback'
import { PlusSheet } from './PlusSheet'
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
 * 設定の「その他」に出す、「ラテ帳 Plus」の行（iPhone・iPad のアプリだけ）。
 * 右に、何が使えるか（買ったあとは「購入済み」）を出し、押すと、シートで、使えるようになる機能を動画で見せ、購入・復元できる。
 * 価格は一覧に出さない（シートの中だけ）。ストアから商品が取れないときは、行を出さない
 */
export function SupportRows() {
  const plus = usePlus()
  const products = useProducts()
  const { busy } = usePurchaseRunner()
  const [open, setOpen] = useState(false)

  if (!canPurchase || !products.plus) return null

  return (
    <>
      <li>
        <button type="button" className="settings-row choice" disabled={busy || plus} onClick={() => setOpen(true)}>
          <span className="settings-label">{t.support.plus}</span>
          <span className="settings-value">{plus ? t.support.purchased : t.support.plusKind}</span>
        </button>
      </li>
      {open && <PlusSheet onUnlocked={() => setOpen(false)} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * 開発を応援する（投げ銭）。設定のいちばん下に、静かな文字リンクとして置く（行にはしない）。
 * 何も解放しない。価格は、押したあとのストアの画面に出る。ストアに商品が無いときは出さない
 */
export function SupportTip() {
  const products = useProducts()
  const { busy, run } = usePurchaseRunner()
  if (!canPurchase || !products.tip) return null
  return (
    <button type="button" className="support-tip" disabled={busy} onClick={() => run(sendTip, t.support.tipThanks)}>
      {t.support.tipShort}
    </button>
  )
}

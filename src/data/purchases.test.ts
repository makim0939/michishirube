import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({
  getPurchases: vi.fn(),
  getProducts: vi.fn(),
  addListener: vi.fn(async (_event: string, _listener: () => void) => ({ remove: async () => {} })),
  purchaseProduct: vi.fn(),
  restorePurchases: vi.fn(),
}))
vi.mock('@capgo/native-purchases', () => ({ NativePurchases: plugin }))
vi.mock('../platform', () => ({ isIosApp: true }))

import { db } from './db'
import {
  buyPlus,
  hasPlus,
  FREE_COMPOSE_USES,
  isCancelled,
  mayCompose,
  plusAccessOf,
  noteComposeUse,
  isPlus,
  loadProducts,
  PRODUCT_PLUS,
  PRODUCT_TIP,
  PurchaseCancelled,
  refreshPlus,
  restorePurchases,
  sendTip,
  watchPurchases,
} from './purchases'

beforeEach(async () => {
  vi.clearAllMocks()
  await db.meta.clear()
})

describe('Plus を買っているかの判定', () => {
  it('購入の一覧に Plus があれば買っている', () => {
    expect(hasPlus([{ productIdentifier: PRODUCT_PLUS }])).toBe(true)
  })

  it('投げ銭だけでは Plus にならない', () => {
    expect(hasPlus([{ productIdentifier: PRODUCT_TIP }])).toBe(false)
  })

  it('返金・取り消しされた Plus は数えない', () => {
    expect(hasPlus([{ productIdentifier: PRODUCT_PLUS, revocationDate: '2026-10-27T00:00:00Z' }])).toBe(false)
  })
})

describe('購入の確認と覚え方', () => {
  it('ストアに Plus があれば、端末に買ったと覚える（今のサインインの購入だけを見る）', async () => {
    plugin.getPurchases.mockResolvedValue({ purchases: [{ productIdentifier: PRODUCT_PLUS }] })
    expect(await refreshPlus()).toBe(true)
    expect(plugin.getPurchases).toHaveBeenCalledWith({ onlyCurrentEntitlements: true })
    expect(await isPlus()).toBe(true)
  })

  it('返金されて一覧から消えたら、次の確認で買っていない状態に戻す', async () => {
    await db.meta.put({ key: 'purchase:plus', value: true })
    plugin.getPurchases.mockResolvedValue({ purchases: [] })
    expect(await refreshPlus()).toBe(false)
    expect(await isPlus()).toBe(false)
  })

  it('ストアに問い合わせられないときは、覚えている結果をそのまま使う', async () => {
    await db.meta.put({ key: 'purchase:plus', value: true })
    plugin.getPurchases.mockRejectedValue(new Error('offline'))
    expect(await refreshPlus()).toBe(true)
    expect(await isPlus()).toBe(true)
  })

  it('復元したら、ストアの結果を覚え直して返す', async () => {
    plugin.restorePurchases.mockResolvedValue(undefined)
    plugin.getPurchases.mockResolvedValue({ purchases: [{ productIdentifier: PRODUCT_PLUS }] })
    expect(await restorePurchases()).toBe(true)
    expect(plugin.restorePurchases).toHaveBeenCalledTimes(1)
    expect(await isPlus()).toBe(true)
  })
})

describe('買う操作', () => {
  it('Plus を買えたら、確認して覚える', async () => {
    plugin.purchaseProduct.mockResolvedValue({})
    plugin.getPurchases.mockResolvedValue({ purchases: [{ productIdentifier: PRODUCT_PLUS }] })
    await buyPlus()
    expect(plugin.purchaseProduct).toHaveBeenCalledWith({ productIdentifier: PRODUCT_PLUS })
    expect(await isPlus()).toBe(true)
  })

  it('買えた直後にストアへ問い合わせられなくても、Plus を使えるようにする', async () => {
    plugin.purchaseProduct.mockResolvedValue({})
    plugin.getPurchases.mockRejectedValue(new Error('offline'))
    await buyPlus()
    expect(await isPlus()).toBe(true)
  })

  it('ストアから購入の知らせが来たら、確認し直す（承認待ちだった購入が、あとで通ったとき）', async () => {
    watchPurchases()
    expect(plugin.addListener).toHaveBeenCalledWith('transactionUpdated', expect.any(Function))
    const onUpdate = plugin.addListener.mock.calls[0][1] as () => void
    plugin.getPurchases.mockResolvedValue({ purchases: [{ productIdentifier: PRODUCT_PLUS }] })
    onUpdate()
    await vi.waitFor(async () => expect(await isPlus()).toBe(true))
  })

  it('投げ銭は Plus を解放しない', async () => {
    plugin.purchaseProduct.mockResolvedValue({})
    await sendTip()
    expect(plugin.purchaseProduct).toHaveBeenCalledWith({ productIdentifier: PRODUCT_TIP })
    expect(await isPlus()).toBe(false)
  })

  it('買う操作をやめたときは、エラーではなくやめたことを表す', async () => {
    plugin.purchaseProduct.mockRejectedValue(new Error('User cancelled'))
    await expect(sendTip()).rejects.toBeInstanceOf(PurchaseCancelled)
    expect(isCancelled(new Error('Purchase was cancelled'))).toBe(true)
    expect(isCancelled(new Error('network down'))).toBe(false)
  })

  it('ほかの失敗は、そのまま投げる', async () => {
    plugin.purchaseProduct.mockRejectedValue(new Error('network down'))
    await expect(sendTip()).rejects.toThrow('network down')
  })
})

describe('「つなぐ」を使ってよいか', () => {
  it('無料で試せる回数までは使え、使い切ると止まる', async () => {
    for (let i = 0; i < FREE_COMPOSE_USES; i++) {
      expect(await mayCompose(true)).toBe(true)
      await noteComposeUse()
    }
    expect(await mayCompose(true)).toBe(false)
  })

  it('Plus を買っていれば、回数に関わらず使え、回数は数えない', async () => {
    await db.meta.put({ key: 'purchase:plus', value: true })
    await db.meta.put({ key: 'purchase:composeUses', value: FREE_COMPOSE_USES })
    expect(await mayCompose(true)).toBe(true)
    await noteComposeUse()
    expect((await db.meta.get('purchase:composeUses'))?.value).toBe(FREE_COMPOSE_USES)
  })

  it('一度でも商品が取れたことがあれば、電波が無くて取れなくても、制限を外さない', async () => {
    plugin.getProducts.mockResolvedValue({ products: [{ identifier: PRODUCT_PLUS }] })
    await loadProducts()
    await db.meta.put({ key: 'purchase:composeUses', value: FREE_COMPOSE_USES })
    expect(await mayCompose(false)).toBe(false)
  })

  it('ストアから Plus の商品が取れないときは、買う手段が無いので止めない', async () => {
    await db.meta.put({ key: 'purchase:composeUses', value: FREE_COMPOSE_USES })
    expect(await mayCompose(false)).toBe(true)
  })
})

describe('Plus の見せ方（編集画面・設定）', () => {
  const base = { canBuy: true, plus: false, listed: true, checked: true, uses: 0 }

  it('買う手段があり未購入なら、有料の機能は並べず、「試す」入口を出す。残りは回数から出す', () => {
    expect(plusAccessOf(base)).toEqual({ open: false, trial: true, locked: false, left: FREE_COMPOSE_USES })
    expect(plusAccessOf({ ...base, uses: 2 }).left).toBe(FREE_COMPOSE_USES - 2)
  })

  it('使い切ると、試す入口は鍵（購入の案内）になる', () => {
    expect(plusAccessOf({ ...base, uses: FREE_COMPOSE_USES })).toMatchObject({ open: false, trial: true, locked: true, left: 0 })
    expect(plusAccessOf({ ...base, uses: FREE_COMPOSE_USES + 5 }).left).toBe(0)
  })

  it('Plus を買っていれば、最初から全部並べ、入口は出さない', () => {
    expect(plusAccessOf({ ...base, plus: true, uses: FREE_COMPOSE_USES })).toMatchObject({ open: true, trial: false, locked: false })
  })

  it('買う手段が無い端末（Android・Web）は、最初から全部並べる', () => {
    expect(plusAccessOf({ ...base, canBuy: false, listed: false })).toMatchObject({ open: true, trial: false })
  })

  it('商品を確かめるまでは決めず、取れないと分かれば全部並べる。前に取れていれば、確認を待たない', () => {
    expect(plusAccessOf({ ...base, listed: false, checked: false })).toMatchObject({ open: false, trial: false })
    expect(plusAccessOf({ ...base, listed: false, checked: true })).toMatchObject({ open: true, trial: false })
    expect(plusAccessOf({ ...base, listed: true, checked: false })).toMatchObject({ open: false, trial: true })
  })
})

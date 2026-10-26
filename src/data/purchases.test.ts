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
  noteComposeUse,
  isPlus,
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

  it('ストアから Plus の商品が取れないときは、買う手段が無いので止めない', async () => {
    await db.meta.put({ key: 'purchase:composeUses', value: FREE_COMPOSE_USES })
    expect(await mayCompose(false)).toBe(true)
  })
})

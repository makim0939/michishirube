import { useLiveQuery } from 'dexie-react-hooks'
import { NativePurchases, type Product } from '@capgo/native-purchases'
import { isIosApp } from '../platform'
import { db } from './db'

/**
 * アプリ内課金（App Store）。買ったかどうかは、ストアの購入履歴（Apple ID に紐づく）を正とし、サーバーには置かない
 * （アプリのアカウントがなくても、買い直さずに復元できる。購入の情報を、こちらでは持たない）。
 * 端末には、結果だけを覚えておく（電波がなくても、前に買ったものが使えるように）。
 * Android は、リリースの準備ができてから足す（canPurchase）
 */

/** 商品の ID（App Store Connect に、同じ ID で登録する） */
export const PRODUCT_PLUS = 'me.makimura.lattecho.app.plus'
export const PRODUCT_TIP = 'me.makimura.lattecho.app.tip'

/** いま買えるか（iPhone・iPad のアプリだけ） */
export const canPurchase = isIosApp

/** Plus なしで「つなぐ」を試せる回数（成功した回数） */
export const FREE_COMPOSE_USES = 3

/** 買ったことを覚えておく場所。端末だけのもの（同期・バックアップには入れない。backup.ts の isLocalMeta） */
const PLUS_KEY = 'purchase:plus'

type PurchaseLike = { productIdentifier: string; revocationDate?: string }

/** 購入の一覧に、Plus が入っているか（返金・取り消しされたものは数えない） */
export function hasPlus(purchases: PurchaseLike[]): boolean {
  return purchases.some((p) => p.productIdentifier === PRODUCT_PLUS && !p.revocationDate)
}

/** ストアに Plus の商品があるのを、一度でも確かめたか（端末だけ） */
const PLUS_LISTED_KEY = 'purchase:plusListed'

/** 試した回数を覚える場所（端末だけ） */
const COMPOSE_USES_KEY = 'purchase:composeUses'

/** 端末に覚えている、Plus を買ったか */
export async function isPlus(): Promise<boolean> {
  return (await db.meta.get(PLUS_KEY))?.value === true
}

/** 画面で使う。買っていれば true（読み込み前・買っていなければ false） */
export function usePlus(): boolean {
  return useLiveQuery(isPlus, [], false)
}

/**
 * ストアに今の購入を問い合わせ、結果を覚える。起動したとき・復元したとき・ストアから購入の知らせが来たときに呼ぶ。
 * 問い合わせに失敗したとき（電波がない・ストアに届かない）は、覚えているものをそのまま使う
 * （買ったのに使えなくならないように。返金は、次に問い合わせられたときに反映する）
 */
export async function refreshPlus(): Promise<boolean> {
  if (!canPurchase) return isPlus()
  try {
    // 今のサインインの Apple ID の購入だけを見る（共有の端末で、前の人の購入が残っていても数えない）
    const { purchases } = await NativePurchases.getPurchases({ onlyCurrentEntitlements: true })
    const plus = hasPlus(purchases)
    await db.meta.put({ key: PLUS_KEY, value: plus })
    return plus
  } catch {
    return isPlus()
  }
}

/** 買う画面に出す商品の情報（名前・価格はストアのもの。取れなければ undefined） */
export async function loadProducts(): Promise<{ plus?: Product; tip?: Product }> {
  if (!canPurchase) return {}
  try {
    const { products } = await NativePurchases.getProducts({ productIdentifiers: [PRODUCT_PLUS, PRODUCT_TIP] })
    const plus = products.find((p) => p.identifier === PRODUCT_PLUS)
    if (plus) await db.meta.put({ key: PLUS_LISTED_KEY, value: true })
    return { plus, tip: products.find((p) => p.identifier === PRODUCT_TIP) }
  } catch {
    return {}
  }
}

/** 買う操作をやめた（エラーとしては出さない） */
export class PurchaseCancelled extends Error {}

/** ストアの購入をやめた・待ち（承認待ち）の知らせか。文言はストアごとに違うので、広めに見る */
export function isCancelled(e: unknown): boolean {
  const message = String((e as { message?: unknown } | null)?.message ?? e)
  return /cancel|pending/i.test(message)
}

async function buy(productIdentifier: string) {
  try {
    await NativePurchases.purchaseProduct({ productIdentifier })
  } catch (e) {
    if (isCancelled(e)) throw new PurchaseCancelled()
    throw e
  }
}

/**
 * Plus を買う。買えたら、そのまま覚える（買った直後にストアへ問い合わせ直さない。
 * 電波がなくて問い合わせに失敗しても、お金を払ったのに使えない状態にしないため。取り消しは、次の確認で反映する）
 */
export async function buyPlus() {
  await buy(PRODUCT_PLUS)
  await db.meta.put({ key: PLUS_KEY, value: true })
}

/**
 * ストアからの購入の知らせ（「承認待ち」だった購入が、あとで承認されたときなど）を受けたら、確認し直す。
 * アプリを開いている間、1回だけ呼ぶ
 */
export function watchPurchases() {
  if (!canPurchase) return
  void NativePurchases.addListener('transactionUpdated', () => void refreshPlus()).catch(() => {})
}

/** 投げ銭（何度でも送れる）。何も解放しない */
export async function sendTip() {
  await buy(PRODUCT_TIP)
}

/** 購入を復元する（機種変更・入れ直しのあと） */
export async function restorePurchases(): Promise<boolean> {
  await NativePurchases.restorePurchases()
  return refreshPlus()
}

/**
 * 「つなぐ」を使ってよいか。Plus を買っている・無料で試せる回数が残っている、のどちらか。
 * plusAvailable は、ストアから Plus の商品が取れたか。一度も取れたことがない（まだ登録・承認されていない）ときは、
 * 買う手段が無いので、止めずに使えるようにする（買えないのに、使えなくならないように）。
 * 一度でも取れたことがあれば、電波が無くて取れなくても、回数の制限を外さない（機内モードで制限を避けられないように）
 */
export async function mayCompose(plusAvailable: boolean): Promise<boolean> {
  const listed = plusAvailable || (await db.meta.get(PLUS_LISTED_KEY))?.value === true
  if (!listed || (await isPlus())) return true
  return ((await db.meta.get(COMPOSE_USES_KEY))?.value as number | undefined ?? 0) < FREE_COMPOSE_USES
}

/** 「つなぐ」に成功した回数を数える（Plus を買っていれば数えない） */
export async function noteComposeUse() {
  if (await isPlus()) return
  const uses = ((await db.meta.get(COMPOSE_USES_KEY))?.value as number | undefined) ?? 0
  await db.meta.put({ key: COMPOSE_USES_KEY, value: uses + 1 })
}

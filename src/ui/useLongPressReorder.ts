import { useEffect, useRef, useState } from 'react'

/** 長押しと見なすまでの時間と、それまでに指が動いてよい距離（これより動いたらスクロール） */
const HOLD_MS = 420
const SLOP_PX = 10
/** 画面の端にこれより近づいたら、ドラッグしながら自動でスクロールする */
const EDGE_PX = 90
const TABBAR_PX = 80

type Drag = {
  id: string
  pointerId: number
  /** 指が要素の上端からどれだけ下をつかんでいるか（たたんだ見出しの高さまでに抑える） */
  grab: number
  y: number
}

/**
 * 長押ししてから動かすと並べ替えられる一覧。`data-reorder-id` を付けた要素を対象にする。
 * ドラッグ中はページのスクロールを止め、指についてくるよう要素を translate で動かす。
 * ドラッグのあとのクリック（カード内のリンク）は無効にする
 */
export function useLongPressReorder(ids: string[], onCommit: (next: string[]) => Promise<boolean> | void) {
  // 一覧はデータを読み込んでから出るので、要素が付いたときに見張り始める
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [order, setOrder] = useState(ids)
  const [dragging, setDragging] = useState<string | null>(null)
  const orderRef = useRef(order)
  orderRef.current = order
  const drag = useRef<Drag | null>(null)
  const commit = useRef(onCommit)
  commit.current = onCommit
  const idsRef = useRef(ids)
  idsRef.current = ids

  // データ側の並びが変わったら（同期・練習の開始や終了）、ドラッグ中でなければ合わせる
  const idsKey = ids.join()
  useEffect(() => {
    if (!drag.current) setOrder(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  useEffect(() => {
    if (!root) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: { id: string; pointerId: number; x: number; y: number; grab: number } | null = null
    let suppressClick = false
    let startOrder = ''

    const itemOf = (id: string) => root.querySelector<HTMLElement>(`[data-reorder-id="${CSS.escape(id)}"]`)

    // 指の位置に要素を置く。並びが変わって要素の自然な位置が動いても、指の下にいるよう translate を合わせる
    const place = () => {
      const d = drag.current
      if (!d) return
      const el = itemOf(d.id)
      if (!el) return
      const current = Number(el.dataset.shift ?? 0)
      const naturalTop = el.getBoundingClientRect().top - current
      const shift = d.y - d.grab - naturalTop
      el.dataset.shift = String(shift)
      el.style.transform = `translateY(${shift}px)`
      // ほかの要素の中心と比べて、入る位置を決める
      const center = d.y - d.grab + el.offsetHeight / 2
      const others = orderRef.current.filter((id) => id !== d.id)
      let to = others.findIndex((id) => {
        const r = itemOf(id)?.getBoundingClientRect()
        return r ? center < r.top + r.height / 2 : false
      })
      if (to < 0) to = others.length
      const next = [...others.slice(0, to), d.id, ...others.slice(to)]
      if (next.join() !== orderRef.current.join()) setOrder(next)
    }

    // 画面の端で指を止めていても、ドラッグ中は自動でスクロールし続ける
    let raf = 0
    const autoScroll = () => {
      const d = drag.current
      if (!d) return
      const step = d.y < EDGE_PX ? -10 : d.y > window.innerHeight - TABBAR_PX - EDGE_PX ? 10 : 0
      if (step) {
        window.scrollBy(0, step)
        place()
      }
      raf = requestAnimationFrame(autoScroll)
    }

    const start = () => {
      if (!pending) return
      drag.current = { id: pending.id, pointerId: pending.pointerId, grab: pending.grab, y: pending.y }
      startOrder = orderRef.current.join()
      pending = null
      suppressClick = true
      // 指が一覧の外（タブなど）に出ても、文字の選択が始まらないようにする
      document.documentElement.classList.add('reordering')
      window.getSelection()?.removeAllRanges()
      setDragging(drag.current.id)
      // たたんだ表示になってから位置を合わせる
      requestAnimationFrame(() => requestAnimationFrame(place))
      raf = requestAnimationFrame(autoScroll)
    }

    const cancelPending = () => {
      clearTimeout(timer)
      pending = null
    }

    const finish = () => {
      cancelPending()
      const d = drag.current
      if (!d) return
      drag.current = null
      cancelAnimationFrame(raf)
      document.documentElement.classList.remove('reordering')
      window.getSelection()?.removeAllRanges()
      const el = itemOf(d.id)
      if (el) {
        el.style.transform = ''
        delete el.dataset.shift
      }
      setDragging(null)
      if (orderRef.current.join() !== startOrder) {
        // 保存できなかったら、保存されている並びに戻す
        void Promise.resolve(commit.current(orderRef.current)).then((ok) => {
          if (ok === false) setOrder(idsRef.current)
        })
      }
      // 離した直後のクリックだけを止める（クリックが来なかったときに、次の操作まで止めないように）
      setTimeout(() => (suppressClick = false), 400)
    }

    const down = (e: PointerEvent) => {
      if (e.button > 0 || drag.current) return
      suppressClick = false
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-reorder-id]')
      if (!item || !root.contains(item)) return
      // ボタンは長押しの対象にしない。並べる相手がいない（1つだけ）ときも始めない
      if ((e.target as HTMLElement).closest('button')) return
      if (root.querySelectorAll('[data-reorder-id]').length < 2) return
      const rect = item.getBoundingClientRect()
      pending = {
        id: item.dataset.reorderId!,
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        grab: Math.min(e.clientY - rect.top, 36),
      }
      timer = setTimeout(start, HOLD_MS)
    }

    const move = (e: PointerEvent) => {
      if (pending && e.pointerId === pending.pointerId) {
        if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > SLOP_PX) cancelPending()
        else pending.y = e.clientY
      }
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      d.y = e.clientY
      place()
    }

    // iPhone では、指を動かし始めるとページのスクロールが始まり pointercancel になるので、
    // ドラッグ中は touchmove を止めてスクロールさせない（passive では止められない）
    const touchMove = (e: TouchEvent) => {
      const d = drag.current
      if (!d) return
      e.preventDefault()
      const t = e.touches[0]
      if (!t) return
      d.y = t.clientY
      place()
    }

    const up = () => finish()

    // スクロールが始まって取り消されたときは、ドラッグ前なら長押しを取りやめる。
    // ドラッグ中の指は touchmove で追い続ける（iPhone は途中で pointercancel を送ることがある）
    const cancel = (e: PointerEvent) => {
      if (!drag.current) cancelPending()
      else if (e.pointerType !== 'touch') finish()
    }

    // 長押しで出る、リンクのプレビューや文字選択のメニューを出さない
    const menu = (e: Event) => {
      if (pending || drag.current) e.preventDefault()
    }

    // 長押し中・ドラッグ中は、指の下（たたんで動いた先の見出しなど）で文字の選択を始めさせない
    const selectStart = (e: Event) => {
      if (pending || drag.current) e.preventDefault()
    }

    // リンクや画像の、端末のドラッグ＆ドロップを始めさせない（始まると指の操作が取り消される）
    const nativeDrag = (e: Event) => e.preventDefault()

    const click = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.preventDefault()
      e.stopPropagation()
    }

    root.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchend', up)
    window.addEventListener('touchcancel', up)
    root.addEventListener('touchmove', touchMove, { passive: false })
    root.addEventListener('contextmenu', menu)
    root.addEventListener('dragstart', nativeDrag)
    document.addEventListener('selectstart', selectStart)
    root.addEventListener('click', click, true)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      document.documentElement.classList.remove('reordering')
      root.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchend', up)
      window.removeEventListener('touchcancel', up)
      root.removeEventListener('touchmove', touchMove)
      root.removeEventListener('contextmenu', menu)
      root.removeEventListener('dragstart', nativeDrag)
      document.removeEventListener('selectstart', selectStart)
      root.removeEventListener('click', click, true)
    }
  }, [root])

  return { containerRef: setRoot, order, dragging }
}

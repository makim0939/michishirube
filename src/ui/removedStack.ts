/** 画面から外した物と、外す前の位置。「元に戻す」で、外した順の逆に戻すために積んでおく */
export interface Removed<T> {
  item: T
  index: number
}

/** 直近に外した物を、元の位置へ戻す。積んである物が無ければ、何もしない */
export function undoLast<T extends { key: string }>(
  list: T[],
  stack: Removed<T>[],
): { list: T[]; stack: Removed<T>[]; restored?: T } {
  const last = stack[stack.length - 1]
  if (!last) return { list, stack }
  const rest = stack.slice(0, -1)
  // すでに入っていれば（同じ物を二重に戻さない）、増やさず、積みだけ進める
  if (list.some((i) => i.key === last.item.key)) return { list, stack: rest }
  const next = [...list]
  next.splice(Math.min(Math.max(last.index, 0), next.length), 0, last.item)
  return { list: next, stack: rest, restored: last.item }
}

/** 外した物の積みと、最後に「元に戻す」を出した時刻 */
export interface UndoState<T> {
  stack: Removed<T>[]
  at: number
}

/** 「元に戻す」のトーストが消える時間を過ぎていたら、積みを捨てる（もう戻せない物を、あとから出さない） */
export function expireUndo<T>(state: UndoState<T>, now: number, ms: number): UndoState<T> {
  return state.stack.length > 0 && now - state.at >= ms ? { stack: [], at: state.at } : state
}

/** 積んである物を、すべて元に戻す（保存に失敗したとき、外した物を失わないように） */
export function undoAll<T extends { key: string }>(list: T[], stack: Removed<T>[]): T[] {
  let cur = list
  let rest = stack
  while (rest.length > 0) {
    const r = undoLast(cur, rest)
    cur = r.list
    rest = r.stack
  }
  return cur
}

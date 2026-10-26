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

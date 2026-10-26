/** 外した物を元の位置へ戻した並びを返す。もう入っていれば、そのまま（トーストを2回押しても増やさない） */
export function restoreAt<T extends { key: string }>(list: T[], item: T, index: number): T[] {
  if (list.some((i) => i.key === item.key)) return list
  const next = [...list]
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item)
  return next
}

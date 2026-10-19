import { useEffect, useRef } from 'react'
import { pushBackHandler } from '../platform'

/**
 * Android の「戻る」を、この画面で受け止める（true を返すと、履歴は戻らない）。
 * 毎回の描画で渡す関数が変わってもよい（登録は1回で、呼ぶときに最新の関数を使う）。
 * iPhone・Web では「戻る」が来ないので、何も起きない
 */
export function useBackHandler(handler: () => boolean) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => pushBackHandler(() => latest.current()), [])
}

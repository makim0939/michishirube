import { useEffect, useRef } from 'react'
import { pushBackHandler } from '../platform'

/**
 * Android の「戻る」を、この画面で受け止める（true を返すと、履歴は戻らない）。
 * 毎回の描画で渡す関数が変わってもよい（登録は1回で、呼ぶときに最新の関数を使う）。
 * iPhone・Web では「戻る」が来ないので、何も起きない。
 * 呼ぶ順は、登録の新しい順＝あとから出た画面が先。React は同じ描画で出た親と子のうち、子の effect を先に走らせるので、
 * 重ねて出す画面（カメラ・編集など）は、親と同じ描画では出さず、あとの描画で出すこと
 */
export function useBackHandler(handler: () => boolean) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => pushBackHandler(() => latest.current()), [])
}

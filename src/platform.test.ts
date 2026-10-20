import { describe, expect, it, vi } from 'vitest'
import { APP_STORE_REVIEW_URL, pushBackHandler, runBackHandlers } from './platform'

describe('App Store の評価の画面', () => {
  it('数字の Apple ID で、評価を書く画面を開く（チーム ID・バンドル ID は使わない）', () => {
    const url = new URL(APP_STORE_REVIEW_URL)
    expect(url.origin).toBe('https://apps.apple.com')
    expect(url.pathname).toMatch(/^\/app\/id\d+$/)
    expect(url.searchParams.get('action')).toBe('write-review')
  })
})

describe('Android の「戻る」の受け皿', () => {
  it('受け皿が無ければ、誰も処理していない（履歴を戻る）', () => {
    expect(runBackHandlers()).toBe(false)
  })

  it('新しく登録した受け皿が先に呼ばれ、処理したら古いものは呼ばれない（編集の上のカメラ、のような重なり）', () => {
    const screen = vi.fn(() => false)
    const overlay = vi.fn(() => true)
    const offScreen = pushBackHandler(screen)
    const offOverlay = pushBackHandler(overlay)
    expect(runBackHandlers()).toBe(true)
    expect(overlay).toHaveBeenCalledTimes(1)
    expect(screen).not.toHaveBeenCalled()
    offOverlay()
    offScreen()
  })

  it('新しい受け皿が処理しなかったら、古い受け皿に任せる', () => {
    const screen = vi.fn(() => true)
    const overlay = vi.fn(() => false)
    const offScreen = pushBackHandler(screen)
    const offOverlay = pushBackHandler(overlay)
    expect(runBackHandlers()).toBe(true)
    expect(overlay).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledTimes(1)
    offOverlay()
    offScreen()
  })

  it('外した受け皿は呼ばれない（画面を閉じたあとに、戻るを横取りし続けない）', () => {
    const handler = vi.fn(() => true)
    const off = pushBackHandler(handler)
    off()
    expect(runBackHandlers()).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('同じ関数を2回登録しても、1回外せば、もう1つは残る', () => {
    const handler = vi.fn(() => true)
    const first = pushBackHandler(handler)
    const second = pushBackHandler(handler)
    first()
    expect(runBackHandlers()).toBe(true)
    second()
    expect(runBackHandlers()).toBe(false)
  })
})

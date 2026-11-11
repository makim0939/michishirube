// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { db } from './data/db'
import { addRecord } from './data/repo'
import { t } from './i18n'

/**
 * 主要な入口（今日・記録・記録の編集・ラテ帳・型・設定）を、実際に描画して、画面が落ちないことを確かめる。
 * フックの数が描画のたびに変わるなど、型検査と単体テストでは見つからず、実機で初めて画面が真っ白になる不具合
 * （#182：記録画面）を、PR の時点で落とすため。落ちると ErrorBoundary が「もう一度」を出し、console.error を出す
 */

// jsdom に無い、画面が使うブラウザの機能（中身は使わないので、何もしない代わり）。
// afterEach で vi.unstubAllGlobals() するので、スタブは毎回入れ直す（beforeAll だと、最初のテストのあとで消える）
function stubBrowserFeatures() {
  const none = () => {}
  class Observer {
    observe = none
    unobserve = none
    disconnect = none
    takeRecords = () => []
  }
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('IntersectionObserver', Observer)
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: none,
    removeEventListener: none,
    addListener: none,
    removeListener: none,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  window.scrollTo = none as typeof window.scrollTo
  URL.createObjectURL ??= () => 'blob:test'
  URL.revokeObjectURL ??= none
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  HTMLMediaElement.prototype.load = none
  HTMLMediaElement.prototype.pause = none
  HTMLMediaElement.prototype.play = () => Promise.resolve()
}

let errors: unknown[][]

beforeEach(() => {
  stubBrowserFeatures()
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args)
  })
  // 同期・YouTube・サーバーへの問い合わせは、どこにも出さない（失敗の扱いは、別の単体テストで見ている）
  vi.stubGlobal('fetch', () => Promise.reject(new Error('テストでは、通信しない')))
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** 画面を移して、描き直しが終わるのを待つ */
async function visit(hash: string) {
  await act(async () => {
    window.location.hash = hash
    await new Promise((r) => setTimeout(r, 0))
  })
}

/** 落ちていないこと：「もう一度」の画面が出ていない・描画の例外が記録されていない */
function expectNotCrashed(where: string) {
  expect(screen.queryByRole('button', { name: t.app.reload }), `${where}：「もう一度」が出ている`).toBeNull()
  expect(errors, `${where}：console.error が出ている ${JSON.stringify(errors.map((e) => String(e[0])))}`).toEqual([])
}

/** 起動して、今日の画面（タブが見える）まで進める */
async function boot() {
  render(<App />)
  await waitFor(() => expect(screen.getByRole('navigation')).toBeTruthy(), { timeout: 5000 })
}

describe('主要な画面を開いても落ちない', () => {
  it('今日 → ラテ帳 → 型 → 設定と、タブで移っても落ちない', async () => {
    await boot()
    expectNotCrashed('今日')
    for (const [hash, label] of [
      ['#/records', t.app.tabRecords],
      ['#/map', t.app.tabSkills],
      ['#/settings', t.app.tabSettings],
      ['#/', t.app.tabToday],
    ] as const) {
      await visit(hash)
      await waitFor(() => expect(screen.getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page'))
      expectNotCrashed(label)
    }
  })

  it('記録画面は、記録を読み込む前も、読み込んだあとも、落ちない（新しい記録・保存した記録の編集）', async () => {
    await boot()
    const skill = (await db.skills.toArray())[0]
    const recordId = await addRecord({ skillId: skill.id, reason: 'スモークテストの理由', nextAction: '', files: [] })

    // 新しい記録（読み込みが要らない）
    await visit(`#/record/${skill.id}`)
    await waitFor(() => expect(document.querySelector('.main')?.textContent?.length).toBeGreaterThan(0))
    expectNotCrashed('新しい記録')

    // 保存した記録の編集：読み込み前（data が無い）から、読み込んだあとへ、フックの数が変わらないこと
    await visit(`#/record/${skill.id}/edit/${recordId}`)
    await waitFor(() => expect(screen.getByDisplayValue('スモークテストの理由')).toBeTruthy(), { timeout: 5000 })
    expectNotCrashed('記録の編集')
  })

  it('1杯の詳細（記録）と、型の画面（個別の型）も、落ちない', async () => {
    await boot()
    const skill = (await db.skills.toArray())[0]
    const recordId = await addRecord({ skillId: skill.id, reason: 'スモークテストの理由', nextAction: '', files: [] })
    await visit(`#/cup/${recordId}`)
    await waitFor(() => expect(screen.getByText('スモークテストの理由')).toBeTruthy(), { timeout: 5000 })
    expectNotCrashed('1杯の詳細')
    await visit(`#/skill/${skill.id}`)
    // 型の名前は「ロゼッタ」「（リーフ）」のように、画面で分けて出すことがある（どの型が選ばれるかは実行ごとに違う）ので、見出しがあることで見る
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy(), { timeout: 5000 })
    expectNotCrashed('型の詳細')
  })

  it('ラテ帳の並べ方を、日付ごととタイルで切り替えられ、選んだ並べ方を覚えている', async () => {
    window.localStorage.removeItem('michishirube:records-layout')
    await boot()
    const skill = (await db.skills.toArray())[0]
    await addRecord({ skillId: skill.id, reason: 'ラテ帳の並べ方', nextAction: '', files: [] })
    await visit('#/records')
    // 初めは日付ごと：見出しが出ている
    const byDay = await screen.findByRole('button', { name: t.records.byDay })
    expect(byDay.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.screen .section h2')).toBeTruthy()

    // タイル：日付の見出しがなくなり、杯は並んだまま
    await act(async () => screen.getByRole('button', { name: t.records.tiles }).click())
    expect(screen.getByRole('button', { name: t.records.tiles }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.screen .section h2')).toBeNull()
    expect(document.querySelectorAll('.cup-tile').length).toBe(1)
    expect(window.localStorage.getItem('michishirube:records-layout')).toBe('tiles')
    expectNotCrashed('ラテ帳（タイル）')

    // 開き直しても、タイルのまま。壊れた値は、日付ごとに戻る
    cleanup()
    await boot()
    await visit('#/records')
    expect((await screen.findByRole('button', { name: t.records.tiles })).getAttribute('aria-pressed')).toBe('true')
    cleanup()
    window.localStorage.setItem('michishirube:records-layout', 'x')
    await boot()
    await visit('#/records')
    expect((await screen.findByRole('button', { name: t.records.byDay })).getAttribute('aria-pressed')).toBe('true')
    window.localStorage.removeItem('michishirube:records-layout')
  })
})

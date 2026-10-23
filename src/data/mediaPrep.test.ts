import { afterEach, describe, expect, it, vi } from 'vitest'
import { canTranscode } from './content'
import { fallBackFromRecorderType, judgeRecording, pickRecorderMimeType, recorderSupports, focusAt, keepAutoFocus, tapToSourcePoint } from './mediaPrep'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

/** この端末の録画の形式の対応（MP4 も WebM も使えると答える端末） */
function device(userAgent: string, store: Record<string, string> = {}) {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints: 5 })
  vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('録画の形式', () => {
  it('iPhone は MP4 だけを使う（WebM で録画すると、編集・共有・画質の作り直しができない）', () => {
    device(IPHONE)
    expect(recorderSupports('video/mp4')).toBe(true)
    expect(recorderSupports('video/webm;codecs=vp9,opus')).toBe(false)
    expect(pickRecorderMimeType(recorderSupports, true, 'standard')).toMatch(/^video\/mp4/)
    expect(pickRecorderMimeType(recorderSupports, false, 'high')).toMatch(/^video\/mp4/)
  })

  it('iPhone では、前に「MP4 は空になる」と覚えていても、MP4 を使い続ける', () => {
    device(IPHONE, { 'michishirube:recorder-broken': JSON.stringify({ ua: IPHONE, types: ['video/mp4'] }) })
    expect(recorderSupports('video/mp4;codecs=avc1.42E01E,mp4a.40.2')).toBe(true)
    expect(pickRecorderMimeType(recorderSupports, true, 'standard')).toMatch(/^video\/mp4/)
  })

  it('Android では、空になった形式を外して、次の形式で撮る', () => {
    device(ANDROID, { 'michishirube:recorder-broken': JSON.stringify({ ua: ANDROID, types: ['video/mp4'] }) })
    expect(recorderSupports('video/mp4')).toBe(false)
    expect(pickRecorderMimeType(recorderSupports, true, 'standard')).toMatch(/^video\/webm/)
  })
})

describe('録画・切り取りに失敗した形式を外す', () => {
  it('Android では、ほかの形式があれば MP4 を外し、次から WebM で撮る・作り直す', () => {
    const store: Record<string, string> = {}
    device(ANDROID, store)
    expect(fallBackFromRecorderType('video/mp4;codecs=avc1.42E01E', false, 'standard')).toBe(true)
    expect(pickRecorderMimeType(recorderSupports, false, 'standard')).toMatch(/^video\/webm/)
  })

  it('iPhone では、失敗しても MP4 を外さない（WebM にすると、編集・共有・アップが壊れる）', () => {
    const store: Record<string, string> = {}
    device(IPHONE, store)
    expect(fallBackFromRecorderType('video/mp4;codecs=avc1.42E01E,mp4a.40.2', true, 'high')).toBe(false)
    expect(store['michishirube:recorder-broken']).toBeUndefined()
    expect(pickRecorderMimeType(recorderSupports, true, 'high')).toMatch(/^video\/mp4/)
  })

  it('ほかの形式が無ければ、外さない（撮れる形式が無くならないように）', () => {
    const store: Record<string, string> = {}
    device(ANDROID, store)
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (t: string) => t.startsWith('video/mp4') })
    expect(fallBackFromRecorderType('video/mp4', true, 'standard')).toBe(false)
    expect(store['michishirube:recorder-broken']).toBeUndefined()
  })
})

describe('動画を作り直せるか', () => {
  it('iPhone のアプリは WebM を作り直せない。そのほかは作り直せる', () => {
    expect(canTranscode({ type: 'video/webm' }, true)).toBe(false)
    expect(canTranscode({ type: 'video/mp4' }, true)).toBe(true)
    expect(canTranscode({ type: 'video/quicktime' }, true)).toBe(true)
    expect(canTranscode({ type: 'video/webm' }, false)).toBe(true)
  })
})

describe('録画の結果の判定', () => {
  it('押してすぐ止めた（2秒より短い）のが空なのは、形式のせいではない', () => {
    expect(judgeRecording(0, 500, true)).toBe('too-short')
    expect(judgeRecording(1_000, 1_500, true)).toBe('ok')
  })

  it('押していないのに、すぐ（3秒より前に）止まった録画は、この形式では撮れない（映像を作る部品が無い端末は、1秒ほどで止まる）', () => {
    expect(judgeRecording(1_559, 1_000, false)).toBe('broken')
    expect(judgeRecording(900_000, 2_500, false)).toBe('broken')
  })

  it('しばらく撮ってから勝手に止まった（電話・アプリの切り替えなど）録画は、形式のせいにせず、撮れた分を残す', () => {
    expect(judgeRecording(900_000, 8_000, false)).toBe('ok')
  })

  it('0 バイト・映像が入らず数 KB だけの録画は、この形式では撮れない', () => {
    expect(judgeRecording(0, 5_000, true)).toBe('broken')
    expect(judgeRecording(1_024, 5_000, true)).toBe('broken')
  })

  it('映像が入っていれば、静かな画面でも問題ない', () => {
    expect(judgeRecording(60_000, 5_000, true)).toBe('ok')
    expect(judgeRecording(750_000, 5_000, true)).toBe('ok')
  })
})

describe('tapToSourcePoint', () => {
  it('枠と映像の縦横比が同じなら、枠の中の位置がそのまま映像の位置になる', () => {
    expect(tapToSourcePoint({ width: 400, height: 225 }, { width: 1280, height: 720 }, { x: 100, y: 112.5 })).toEqual({
      x: 0.25,
      y: 0.5,
    })
  })

  it('縦長の画面に横長の映像を cover で映すと、はみ出て見えない左右の分をずらして計算する', () => {
    // 画面 400x800 に 1280x720 → 倍率 800/720、映像の幅は約 1422px で左右に約 511px ずつはみ出る
    const p = tapToSourcePoint({ width: 400, height: 800 }, { width: 1280, height: 720 }, { x: 200, y: 400 })
    expect(p?.x).toBeCloseTo(0.5)
    expect(p?.y).toBeCloseTo(0.5)
    const left = tapToSourcePoint({ width: 400, height: 800 }, { width: 1280, height: 720 }, { x: 0, y: 0 })
    expect(left?.x).toBeCloseTo((511.1 / 1422.2), 2)
    expect(left?.y).toBe(0)
  })

  it('映像の大きさがまだ分からないときは、場所を返さない', () => {
    expect(tapToSourcePoint({ width: 400, height: 800 }, { width: 0, height: 0 }, { x: 10, y: 10 })).toBeUndefined()
  })
})

describe('ピント合わせ', () => {
  const fakeTrack = (focusMode: string[] | undefined) => {
    const applied: unknown[] = []
    const track = {
      readyState: 'live',
      getCapabilities: () => (focusMode ? { focusMode } : {}),
      applyConstraints: vi.fn(async (c: unknown) => void applied.push(c)),
    } as unknown as MediaStreamTrack
    return { track, applied }
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('focusMode に対応していない端末では、何も指定せず false を返す', async () => {
    const { track, applied } = fakeTrack(undefined)
    expect(await keepAutoFocus(track)).toBe(false)
    vi.stubGlobal('navigator', { mediaDevices: { getSupportedConstraints: () => ({ pointsOfInterest: true }) } })
    expect(await focusAt(track, { x: 0.5, y: 0.5 })).toBe(false)
    expect(applied).toEqual([])
  })

  it('押した場所に合わせたあと、1.5秒で自動に戻す。続けて押したら、前のタイマーは取り消す', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { mediaDevices: { getSupportedConstraints: () => ({ pointsOfInterest: true }) } })
    const { track, applied } = fakeTrack(['continuous', 'single-shot'])
    expect(await focusAt(track, { x: 0.2, y: 0.2 })).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await focusAt(track, { x: 0.8, y: 0.8 })).toBe(true)
    await vi.advanceTimersByTimeAsync(1000) // 最初の押下から2秒。前のタイマーが生きていれば、ここで自動に戻ってしまう
    expect(applied).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(600)
    expect(applied).toHaveLength(3)
    expect(applied[2]).toEqual({ advanced: [{ focusMode: 'continuous' }] })
  })
})

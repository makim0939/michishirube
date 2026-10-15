import { afterEach, describe, expect, it, vi } from 'vitest'
import { canTranscode } from './content'
import { pickRecorderMimeType, recorderSupports } from './mediaPrep'

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

describe('動画を作り直せるか', () => {
  it('iPhone のアプリは WebM を作り直せない。そのほかは作り直せる', () => {
    expect(canTranscode({ type: 'video/webm' }, true)).toBe(false)
    expect(canTranscode({ type: 'video/mp4' }, true)).toBe(true)
    expect(canTranscode({ type: 'video/quicktime' }, true)).toBe(true)
    expect(canTranscode({ type: 'video/webm' }, false)).toBe(true)
  })
})

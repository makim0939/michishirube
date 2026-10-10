import { extensionFor, pickRecorderMimeType, RECORDER_BITRATE } from './mediaPrep'

/**
 * 動画を切り取る。指定した範囲を再生しながら、映像はキャンバス、音声は Web Audio 経由で録り直す。
 * 再エンコードなので、切り取った長さぶんの時間がかかる（30秒なら30秒）。
 *
 * iPhone では音つきの再生にタップが要るので、startTrim() はボタンを押した処理の中で同期的に呼ぶこと。
 * AudioContext も、最初のタップの中で作って渡す
 */

export interface TrimRange {
  start: number
  end: number
}

export interface TrimJob {
  /** 終わると切り取った動画。キャンセルすると reject */
  done: Promise<File>
  cancel(): void
}

/** 範囲を整える。0.3秒より短くはしない */
export function clampRange(range: TrimRange, duration: number): TrimRange {
  const start = Math.max(0, Math.min(range.start, duration))
  const end = Math.max(0, Math.min(range.end, duration))
  if (end - start >= 0.3) return { start, end }
  return { start: Math.max(0, Math.min(start, duration - 0.3)), end: Math.min(duration, Math.max(start, 0) + 0.3) }
}

/**
 * 実際に録れた長さが、指定した範囲の半分以上か。
 * 途中で止まった・1コマしか録れなかったものを、成功として元の動画と入れ替えないための確認
 */
export function isLongEnough(recordedSeconds: number, range: TrimRange): boolean {
  const wanted = range.end - range.start
  return recordedSeconds >= Math.min(wanted * 0.5, wanted - 0.3)
}

/** 録画の解像度の上限（元の動画と同じ 720p 相当） */
const MAX_EDGE = 1280

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number
}

/**
 * video はすでに読み込み済みの要素（src を設定し、loadedmetadata まで済んでいるもの）を渡す。
 * 処理のあいだ video を再生するので、画面に出していてもよい
 */
export function startTrim(video: HTMLVideoElement, audio: AudioContext, range: TrimRange, fileName: string): TrimJob {
  const mimeType = pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t), true)
  if (!mimeType) {
    return { done: Promise.reject(new Error('この端末では動画を作り直せません')), cancel: () => {} }
  }

  // ---- ここまでをタップの処理の中で同期的に行う（iPhone の自動再生の制限のため） ----
  void audio.resume()
  const source = audioSourceFor(video, audio)
  const audioOut = audio.createMediaStreamDestination()
  // 録り直している間はスピーカーから鳴らさず、録音にだけ流す
  source.disconnect()
  source.connect(audioOut)
  video.muted = false
  // タップの中で一度だけ再生を始めて止め、この video の音つき再生を許可させる。
  // 実際の再生は、始めの位置へ移動し終えてから行う（移動中に再生を始めると、先頭がずれるため）
  video.play().catch(() => {
    // すぐ止めるので AbortError になる。許可を得るのが目的なので無視する
  })
  video.pause()
  video.currentTime = range.start
  const playing = (async () => {
    if (video.seeking || Math.abs(video.currentTime - range.start) > 0.05) {
      await new Promise<void>((resolve) => video.addEventListener('seeked', () => resolve(), { once: true }))
    }
    await video.play()
  })()
  // ------------------------------------------------------------------------------

  const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale) || 1280
  canvas.height = Math.round(video.videoHeight * scale) || 720
  const draw = canvas.getContext('2d')!
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...audioOut.stream.getAudioTracks()])
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: RECORDER_BITRATE.video,
    audioBitsPerSecond: RECORDER_BITRATE.audio,
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  let stopped = false
  let cancelled = false
  let failed: string | null = null
  // 実際に録れた範囲（コマの時刻）。指定より大きく足りなければ失敗にする
  let firstTime: number | null = null
  let lastTime = 0
  recorder.onerror = (e: Event) => {
    const err = (e as Event & { error?: DOMException }).error
    failed = err?.message || 'エンコードに失敗しました'
    finish()
  }
  const v = video as VideoWithFrameCallback
  const nextFrame = (cb: (mediaTime: number) => void) => {
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback((_, meta) => cb(meta.mediaTime))
    else requestAnimationFrame(() => cb(video.currentTime))
  }
  // 表示されたコマの時刻（mediaTime）で、終わりに達したかを見る
  const frame = (mediaTime: number) => {
    if (stopped) return
    draw.drawImage(video, 0, 0, canvas.width, canvas.height)
    firstTime ??= mediaTime
    lastTime = mediaTime
    // 始めの位置へ移動し終わる前の位置で「終わり」と判定しない
    if (!video.seeking && (mediaTime >= range.end || video.ended)) {
      finish()
      return
    }
    nextFrame(frame)
  }

  let settled = false
  let resolveDone!: (file: File) => void
  let rejectDone!: (e: Error) => void
  const done = new Promise<File>((resolve, reject) => {
    resolveDone = (f) => {
      if (!settled) resolve(f)
      settled = true
    }
    rejectDone = (e) => {
      if (!settled) reject(e)
      settled = true
    }
  })

  const cleanup = () => {
    video.pause()
    video.muted = true
    // 録り終えたら、プレビューの音がまたスピーカーから出るように戻す
    source.disconnect()
    source.connect(audio.destination)
    stream.getTracks().forEach((t) => t.stop())
  }

  const finish = () => {
    if (stopped) return
    stopped = true
    if (recorder.state !== 'inactive') recorder.stop()
    else cleanup()
  }

  recorder.onstop = () => {
    cleanup()
    if (cancelled) {
      rejectDone(new Error('キャンセルしました'))
      return
    }
    if (failed) {
      rejectDone(new Error(`動画を作り直せませんでした（${failed}）。元の動画はそのままです`))
      return
    }
    const type = (recorder.mimeType || mimeType).split(';')[0]
    const blob = new Blob(chunks, { type })
    const recorded = firstTime === null ? 0 : lastTime - firstTime
    if (blob.size === 0 || !isLongEnough(recorded, range)) {
      rejectDone(new Error('途中で止まり、最後まで作り直せませんでした。元の動画はそのままです'))
      return
    }
    const base = fileName.replace(/\.[^.]+$/, '')
    resolveDone(new File([blob], `${base}-trim.${extensionFor(type)}`, { type }))
  }

  playing
    .then(() => {
      if (stopped) return
      // 再生が実際に進んで最初のコマが出てから録り始める（止まったコマが先頭に入らないように）
      nextFrame((mediaTime) => {
        if (stopped) return
        draw.drawImage(video, 0, 0, canvas.width, canvas.height)
        recorder.start(1000)
        frame(mediaTime)
      })
    })
    .catch((e: unknown) => {
      stopped = true
      cleanup()
      rejectDone(new Error(e instanceof Error ? `再生できませんでした（${e.message}）` : '再生できませんでした'))
    })

  return {
    done,
    cancel: () => {
      cancelled = true
      if (recorder.state === 'inactive') {
        // まだ録り始めていない、または録画がすでに止まっている
        stopped = true
        cleanup()
        rejectDone(new Error('キャンセルしました'))
        return
      }
      finish()
    },
  }
}

/**
 * MediaElementAudioSource は1つの video に1回しか作れないので使い回す。
 * 呼び出し側は、同じ video には同じ AudioContext を渡す（画面を開いている間は1つを使い続ける）
 */
const sources = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>()

function audioSourceFor(video: HTMLVideoElement, context: AudioContext): MediaElementAudioSourceNode {
  const existing = sources.get(video)
  if (existing) return existing
  const node = context.createMediaElementSource(video)
  sources.set(video, node)
  return node
}

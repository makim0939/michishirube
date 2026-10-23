import { dlog, traceVideo } from '../debug'
import { extensionFor, fallBackFromRecorderType, pickRecorderMimeType, QUALITY, recorderSupports } from './mediaPrep'

/**
 * 動画を切り取る・音を消す。指定した範囲を再生しながら、映像はキャンバス、音声は Web Audio 経由で録り直す
 * （音を消すときは映像だけを録る）。
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


type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number
}

/**
 * video はすでに読み込み済みの要素（src を設定し、loadedmetadata まで済んでいるもの）を渡す。
 * 処理のあいだ video を再生するので、画面に出していてもよい
 */
export function startTrim(
  video: HTMLVideoElement,
  audio: AudioContext,
  range: TrimRange,
  fileName: string,
  { muted = false }: { muted?: boolean } = {},
): TrimJob {
  // 元の動画の画質を保つ（高画質で撮った動画は高画質のまま、それ以外は標準に）
  const quality = Math.min(video.videoWidth, video.videoHeight) > QUALITY.standard.shortSide ? 'high' : 'standard'
  const preset = QUALITY[quality]
  const mimeType = pickRecorderMimeType(recorderSupports, !muted, quality)
  if (!mimeType) {
    return { done: Promise.reject(new Error('この端末では動画を作り直せません')), cancel: () => {} }
  }

  const scale = Math.min(1, preset.shortSide / Math.min(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale) || 1280
  canvas.height = Math.round(video.videoHeight * scale) || 720
  const draw = canvas.getContext('2d')!

  // ---- ここまでをタップの処理の中で同期的に行う（iPhone の自動再生の制限のため） ----
  const untrace = traceVideo(video, 'trim')
  dlog('trim start', range, mimeType, 'audio', audio.state, 'rs', video.readyState, 'muted', muted)
  // 音を消すときは、音声の経路を作らない（映像だけを録る）
  let source: MediaElementAudioSourceNode | null = null
  let audioOut: MediaStreamAudioDestinationNode | null = null
  let stream: MediaStream | null = null
  let recorder: MediaRecorder
  // 録画の準備（音の経路の付け替え・MediaRecorder を作る）は、再生を始める前に済ませる。
  // ここで失敗したとき、音をスピーカーに戻し、再生も始めないまま、失敗を返せるように
  // （作れない形式・端末で例外になると、プレビューの音が消えたまま、画面にも何も出なくなるため）
  try {
    if (!muted) {
      void audio.resume()
      source = audioSourceFor(video, audio)
      audioOut = audio.createMediaStreamDestination()
      // 録り直している間はスピーカーから鳴らさず、録音にだけ流す
      source.disconnect()
      source.connect(audioOut)
    }
    stream = new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...(audioOut ? audioOut.stream.getAudioTracks() : []),
    ])
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: preset.video,
      ...(muted ? {} : { audioBitsPerSecond: preset.audio }),
    })
  } catch (e) {
    dlog('recorder create failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    untrace()
    restoreSpeaker(source, audio)
    stream?.getTracks().forEach((t) => t.stop())
    return {
      done: Promise.reject(new Error('この端末では動画を作り直せませんでした。元の動画はそのままです')),
      cancel: () => {},
    }
  }
  video.muted = muted
  // タップの中で一度だけ再生を始めて止め、この video の音つき再生を許可させる。
  // 実際の再生は、始めの位置へ移動し終えてから行う（移動中に再生を始めると、先頭がずれるため）
  video.play().catch((e: unknown) => {
    // すぐ止めるので AbortError になる。許可を得るのが目的なので無視する
    dlog('unlock play rejected', e instanceof Error ? e.name : String(e))
  })
  video.pause()
  video.currentTime = range.start
  const playing = (async () => {
    await waitUntilSeekable(video, range.start)
    dlog('seek done, play', video.currentTime.toFixed(2), 'rs', video.readyState)
    await video.play()
    dlog('play resolved')
  })()
  // ------------------------------------------------------------------------------

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
    dlog('recorder error', err?.message)
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

  // 動画の終わりまで録るとき、最後のコマのあとは requestVideoFrameCallback が呼ばれないので、終わりの通知でも止める
  const onEnded = () => {
    dlog('ended', video.currentTime)
    if (firstTime !== null) lastTime = Math.max(lastTime, video.currentTime)
    finish()
  }
  video.addEventListener('ended', onEnded)
  // 途中で画面が隠れた（アプリの切り替え）せいで止まったのなら、形式のせいにしない
  let hidden = false
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') hidden = true
  }
  document.addEventListener('visibilitychange', onVisibility)

  /**
   * 失敗の知らせ。録画の部品のせい（エラー・勝手に止まった・空）なら、Android ではほかの形式に切り替えて、
   * 次からはそちらで作り直す（H.264 を作る部品が無い端末で、MP4 のまま、ずっと失敗し続けないように）。
   * iPhone はほかの形式が無いので、切り替えない（MP4 のまま）
   */
  const failure = (message: string, byEncoder: boolean) => {
    if (byEncoder && !hidden && document.visibilityState !== 'hidden' && fallBackFromRecorderType(mimeType, !muted, quality)) {
      dlog('trim: mark broken', mimeType)
      return new Error('この端末に合う形式に切り替えました。もう一度「完了」を押してください。元の動画はそのままです')
    }
    return new Error(message)
  }

  const cleanup = () => {
    video.removeEventListener('ended', onEnded)
    untrace()
    dlog('cleanup', 'frames', firstTime, lastTime, 'chunks', chunks.length)
    video.pause()
    video.muted = true
    document.removeEventListener('visibilitychange', onVisibility)
    restoreSpeaker(source, audio)
    stream?.getTracks().forEach((t) => t.stop())
  }

  const finish = () => {
    if (stopped) return
    stopped = true
    if (recorder.state !== 'inactive') {
      recorder.stop()
      return
    }
    // 録り始める前に終わった（動画が最後まで進んでしまった・失敗した）。待たせたままにしない
    cleanup()
    rejectDone(
      failed
        ? failure(`動画を作り直せませんでした（${failed}）。元の動画はそのままです`, true)
        : new Error('動画を作り直せませんでした。もう一度試してください。元の動画はそのままです'),
    )
  }

  recorder.onstop = () => {
    // 止めていないのに止まった（録画の部品が途中で止めた）。コマを描き続けないように、ここで止める
    const stoppedItself = !stopped
    stopped = true
    cleanup()
    if (cancelled) {
      rejectDone(new Error('キャンセルしました'))
      return
    }
    if (failed) {
      rejectDone(failure(`動画を作り直せませんでした（${failed}）。元の動画はそのままです`, true))
      return
    }
    const type = (recorder.mimeType || mimeType).split(';')[0]
    const blob = new Blob(chunks, { type })
    const recorded = firstTime === null ? 0 : lastTime - firstTime
    if (blob.size === 0 || stoppedItself || !isLongEnough(recorded, range)) {
      rejectDone(
        failure('途中で止まり、最後まで作り直せませんでした。元の動画はそのままです', blob.size === 0 || stoppedItself),
      )
      return
    }
    const base = fileName.replace(/\.[^.]+$/, '').replace(/-edit$/, '')
    resolveDone(new File([blob], `${base}-edit.${extensionFor(type)}`, { type }))
  }

  playing
    .then(() => {
      if (stopped) return
      // 再生が実際に進んで最初のコマが出てから録り始める（止まったコマが先頭に入らないように）
      nextFrame((mediaTime) => {
        if (stopped) return
        dlog('first frame', mediaTime)
        draw.drawImage(video, 0, 0, canvas.width, canvas.height)
        try {
          recorder.start(1000)
        } catch (e) {
          // ここで投げると、呼び出し元に届かず、いつまでも「作り直しています」のままになる
          dlog('recorder start failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e))
          stopped = true
          cleanup()
          rejectDone(new Error('この端末では動画を作り直せませんでした。元の動画はそのままです'))
          return
        }
        frame(mediaTime)
      })
    })
    .catch((e: unknown) => {
      dlog('playing rejected', e instanceof Error ? `${e.name}: ${e.message}` : String(e))
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
 * 始めの位置へ移動し終え、そのコマを表示できるまで待つ。
 * iPhone の Safari は、データを読み込む前に今と同じ位置へ移動させると seeking だけ起きて seeked が来ないことがあるので、
 * イベントだけに頼らず状態を見て判断する（5秒たったら先へ進む）
 */
export function waitUntilSeekable(video: HTMLVideoElement, target: number, timeoutMs = 5000): Promise<void> {
  const ready = () =>
    !video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Math.abs(video.currentTime - target) < 0.25
  if (ready()) return Promise.resolve()
  return new Promise((resolve) => {
    const events = ['seeked', 'loadeddata', 'canplay', 'timeupdate']
    const done = () => {
      clearInterval(timer)
      clearTimeout(limit)
      events.forEach((e) => video.removeEventListener(e, check))
      resolve()
    }
    const check = () => {
      if (ready()) done()
    }
    events.forEach((e) => video.addEventListener(e, check))
    const timer = setInterval(check, 100)
    const limit = setTimeout(done, timeoutMs)
  })
}

/** 録り終えたら（または準備で失敗したら）、プレビューの音がまたスピーカーから出るように戻す */
function restoreSpeaker(source: MediaElementAudioSourceNode | null, audio: AudioContext) {
  if (!source) return
  source.disconnect()
  source.connect(audio.destination)
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

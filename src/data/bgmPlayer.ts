import { bgmBlob, type BgmChoice } from './bgm'

/**
 * 「仕上げる」画面で、BGM を流す。繰り返すとき、継ぎ目で音が途切れないようにする。
 * 同梱の曲は、継ぎ目を合わせて作ってある（docs/bgm.md）ので、AudioBuffer を loop で流す
 * （audio 要素の loop は、継ぎ目に短い間があく。iPhone は、audio 要素の音量も変えられない）。
 * 利用者のファイルは、長いことが多く、全部を展開するとメモリを食うので、audio 要素で流す
 */
export class BgmPlayer {
  private source?: AudioBufferSourceNode

  private constructor(
    private readonly ctx: AudioContext,
    private readonly gain: GainNode,
    private readonly buffer: AudioBuffer | undefined,
    private readonly el: HTMLAudioElement | undefined,
    private readonly objectUrl: string,
  ) {}

  static async create(choice: BgmChoice, volume: number): Promise<BgmPlayer> {
    const blob = await bgmBlob(choice)
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    gain.gain.value = volume
    gain.connect(ctx.destination)
    try {
      if (choice.kind === 'bundled') {
        const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
        return new BgmPlayer(ctx, gain, buffer, undefined, '')
      }
      const objectUrl = URL.createObjectURL(blob)
      const el = new Audio(objectUrl)
      el.loop = true
      ctx.createMediaElementSource(el).connect(gain)
      return new BgmPlayer(ctx, gain, undefined, el, objectUrl)
    } catch (e) {
      void ctx.close().catch(() => {})
      throw e
    }
  }

  /** 曲の長さ（秒）。分からなければ 0 */
  get duration(): number {
    const d = this.buffer?.duration ?? this.el?.duration ?? 0
    return Number.isFinite(d) ? d : 0
  }

  /** at 秒の位置から流す（曲より長ければ、繰り返した位置になる） */
  play(at: number) {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    const offset = this.duration > 0 ? at % this.duration : 0
    if (this.buffer) {
      this.stopSource()
      const s = this.ctx.createBufferSource()
      s.buffer = this.buffer
      s.loop = true
      s.connect(this.gain)
      s.start(0, offset)
      this.source = s
    } else if (this.el) {
      this.el.currentTime = offset
      void this.el.play().catch(() => {})
    }
  }

  pause() {
    this.stopSource()
    this.el?.pause()
  }

  /** 音量（0〜1） */
  setVolume(v: number) {
    this.gain.gain.value = v
  }

  dispose() {
    this.pause()
    void this.ctx.close().catch(() => {})
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
  }

  private stopSource() {
    if (!this.source) return
    try {
      this.source.stop()
    } catch {
      // すでに止まっている
    }
    this.source.disconnect()
    this.source = undefined
  }
}

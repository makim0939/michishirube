import { useState } from 'react'
import { inMemory } from '../data/mediaPrep'
import type { Media } from '../domain/types'
import { saveFile } from './common'
import { useToast } from './feedback'
import { ShareIcon } from './icons'

function fileNameFor(media: Media): string {
  const d = new Date(media.createdAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  const ext = media.type.includes('mp4')
    ? 'mp4'
    : media.type.includes('webm')
      ? 'webm'
      : media.type.includes('png')
        ? 'png'
        : 'jpg'
  return `latte-${stamp}.${ext}`
}

/**
 * 動画・写真を、端末の写真アプリに保存したり、ほかのアプリで共有したりする（iPhone の共有シート）。
 * iPhone は、押してから時間がかかると共有シートを開けないので、開けなかったときはメモリに写して「もう一度押す」にする
 */
export function ShareMediaButton({ media, blob }: { media: Media; blob: Blob }) {
  const toast = useToast()
  const [prepared, setPrepared] = useState<File>()
  const [preparing, setPreparing] = useState(false)
  const name = fileNameFor(media)

  const share = async () => {
    const file = prepared ?? new File([blob], name, { type: media.type })
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (!touch || !navigator.canShare?.({ files: [file] })) {
      // PC など：ファイルとして保存する
      await saveFile(file, name)
      return
    }
    try {
      await navigator.share({ files: [file] })
      setPrepared(undefined)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      if (prepared) {
        toast.show('共有できませんでした', 'error')
        return
      }
      // 端末の保存場所から読むのに時間がかかって開けなかった：メモリに写して、もう一度押してもらう
      setPreparing(true)
      try {
        setPrepared(new File([await inMemory(blob)], name, { type: media.type }))
        toast.show('準備できました。もう一度「保存・共有」を押してください')
      } catch {
        toast.show('共有できませんでした', 'error')
      } finally {
        setPreparing(false)
      }
    }
  }

  return (
    <button type="button" className="keep" disabled={preparing} onClick={() => void share()}>
      <ShareIcon size={13} />
      {preparing ? '準備中…' : prepared ? 'もう一度押す' : '保存・共有'}
    </button>
  )
}

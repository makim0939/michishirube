import { useEffect, useRef, useState } from 'react'
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
 *
 * iPhone は、端末の保存場所（IndexedDB）にある動画をそのまま共有シートに渡すと、読めずに何も起きないことがある。
 * そのため、画面に出たときに先にメモリへ写しておき、押したらすぐ、写したものを渡す
 * （押してから写すと時間がかかり、共有シートを開くのに必要な「直前のタップ」が切れる）
 */
export function ShareMediaButton({ media, blob }: { media: Media; blob: Blob }) {
  const toast = useToast()
  const name = fileNameFor(media)
  const [ready, setReady] = useState<{ key: string; file: File }>()
  const [waiting, setWaiting] = useState(false)
  // 同じ中身の間は写し直さない（同期や「端末に残す」の切り替えで media が読み直されても）
  const key = `${media.id}-${media.contentAt ?? 0}-${blob.size}`
  const latest = useRef(blob)
  latest.current = blob

  useEffect(() => {
    let cancelled = false
    inMemory(latest.current)
      .then((b) => {
        if (!cancelled) setReady({ key, file: new File([b], name, { type: media.type }) })
      })
      .catch(() => {
        // 写せなければ、押したときにもう一度試す
      })
    return () => {
      cancelled = true
    }
    // 中身が同じ間は写し直さない
  }, [key])

  const file = ready?.key === key ? ready.file : undefined

  const share = async () => {
    if (!file) {
      // まだ写し終えていない：写し終えたら、もう一度押してもらう
      setWaiting(true)
      try {
        const b = await inMemory(blob)
        setReady({ key, file: new File([b], name, { type: media.type }) })
        toast.show('準備できました。もう一度押してください')
      } catch {
        toast.show('共有できませんでした', 'error')
      } finally {
        setWaiting(false)
      }
      return
    }
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (!touch || !navigator.canShare?.({ files: [file] })) {
      // PC など：ファイルとして保存する
      await saveFile(file, name)
      return
    }
    try {
      await navigator.share({ files: [file] })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      toast.show('共有できませんでした', 'error')
    }
  }

  return (
    <button type="button" className="tool-button" disabled={waiting} onClick={() => void share()}>
      <ShareIcon size={17} />
      {waiting ? '準備中…' : '保存・共有'}
    </button>
  )
}

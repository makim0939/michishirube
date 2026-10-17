import { useEffect, useRef, useState } from 'react'
import { inMemory } from '../data/mediaPrep'
import { youtubeUrl } from '../data/youtube'
import { formatFileStamp } from '../domain/format'
import type { Media } from '../domain/types'
import { saveFile } from './common'
import { useToast } from './feedback'
import { ShareIcon } from './icons'

function fileNameFor(media: Media, type: string): string {
  const ext = type.includes('mp4')
    ? 'mp4'
    : type.includes('webm')
      ? 'webm'
      : type.includes('quicktime')
        ? 'mov'
        : type.includes('png')
        ? 'png'
        : 'jpg'
  return `latte-${formatFileStamp(new Date(media.createdAt))}.${ext}`
}

/**
 * ファイルを共有シートで送る（写真アプリへの保存も共有シートから）。PC など共有シートが無ければ、ファイルとして保存する。
 * 押した直後に呼ぶこと（共有シートを開くには、直前のタップが要る）。送れなかったら false
 */
async function shareFile(file: File): Promise<boolean> {
  const touch = window.matchMedia('(pointer: coarse)').matches
  if (!touch || !navigator.canShare?.({ files: [file] })) {
    try {
      await saveFile(file, file.name)
      return true
    } catch {
      return false
    }
  }
  try {
    await navigator.share({ files: [file] })
    return true
  } catch (e) {
    // 共有シートを閉じただけなら、失敗ではない
    return e instanceof DOMException && e.name === 'AbortError'
  }
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
  // 画質をそろえた動画は、元が WebM・MOV でも MP4 になっているので、中身の種類で決める
  const type = blob.type || media.type
  const name = fileNameFor(media, type)
  const [ready, setReady] = useState<{ key: string; file: File }>()
  const [waiting, setWaiting] = useState(false)
  // 同じ中身の間は写し直さない（同期で media が読み直されても）
  const key = `${media.id}-${media.contentAt ?? 0}-${blob.size}`
  const latest = useRef(blob)
  latest.current = blob

  useEffect(() => {
    let cancelled = false
    inMemory(latest.current)
      .then((b) => {
        if (!cancelled) setReady({ key, file: new File([b], name, { type }) })
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
        setReady({ key, file: new File([b], name, { type }) })
        toast.show('準備できました。もう一度押してください')
      } catch {
        toast.show('共有できませんでした', 'error')
      } finally {
        setWaiting(false)
      }
      return
    }
    if (!(await shareFile(file))) toast.show('共有できませんでした', 'error')
  }

  return (
    <button type="button" className="tool-button" disabled={waiting} onClick={() => void share()}>
      <ShareIcon size={17} />
      {waiting ? '準備中…' : '保存・共有'}
    </button>
  )
}

/** 端末に無く YouTube にだけある動画は、ファイルの代わりに YouTube のリンクを送る（PC ではリンクを写す） */
export function ShareLinkButton({ youtubeId }: { youtubeId: string }) {
  const toast = useToast()
  const url = youtubeUrl(youtubeId)
  const share = async () => {
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (touch && navigator.share) {
      try {
        await navigator.share({ url })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        toast.show('共有できませんでした', 'error')
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.show('リンクを写しました')
    } catch {
      toast.show('リンクを写せませんでした', 'error')
    }
  }
  return (
    <button type="button" className="tool-button" onClick={() => void share()}>
      <ShareIcon size={17} />
      リンクを共有
    </button>
  )
}

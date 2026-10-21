import type { VideoStorage } from '../data/videoStorage'

/**
 * 設定「動画」に、YouTube の欄（ログイン・つなぐ・つなぐのをやめる）を出すか。
 * 保存先が YouTube のときに出す。すでにつないでいるときは、保存先を端末に戻していても出す
 * （つなぐのをやめる操作が、保存先を YouTube に戻さないと見えなくならないように）
 */
export function showYoutubeSection(storage: VideoStorage, connected: boolean): boolean {
  return storage === 'youtube' || connected
}

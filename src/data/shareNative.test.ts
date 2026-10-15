import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capacitor のプラグインは、呼ばれた順番と中身だけ覚える
const calls = vi.hoisted(() => ({
  log: [] as string[],
  shareError: undefined as unknown,
  written: [] as { path: string; directory: string; size: number }[],
}))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    rmdir: async ({ path, directory }: { path: string; directory: string }) => void calls.log.push(`rmdir ${directory}/${path}`),
    writeFile: async ({ path, directory, data }: { path: string; directory: string; data: string }) => {
      calls.log.push(`write ${directory}/${path}`)
      calls.written.push({ path, directory, size: data.length })
    },
    appendFile: async () => void calls.log.push('append'),
    getUri: async ({ path, directory }: { path: string; directory: string }) => ({ uri: `file:///${directory}/${path}` }),
  },
}))
vi.mock('@capacitor/share', () => ({
  Share: {
    share: async ({ files }: { files: string[] }) => {
      calls.log.push(`share ${files[0]}`)
      if (calls.shareError) throw calls.shareError
    },
  },
}))

const { shareFileNative } = await import('./files')

describe('Android で、ファイルを共有シートに渡す', () => {
  beforeEach(() => {
    calls.log = []
    calls.written = []
    calls.shareError = undefined
  })

  it('前に共有したファイルを片付けてから、キャッシュに書いて、そのファイルを共有する', async () => {
    await shareFileNative(new File(['video'], 'latte-1.mp4', { type: 'video/mp4' }))
    expect(calls.log).toEqual(['rmdir CACHE/share', 'write CACHE/share/latte-1.mp4', 'share file:///CACHE/share/latte-1.mp4'])
  })

  it('大きなファイルは、少しずつ足して書く', async () => {
    await shareFileNative(new File([new Uint8Array(3 * 256 * 1024 + 10)], 'big.mp4', { type: 'video/mp4' }))
    expect(calls.log.filter((l) => l === 'append')).toHaveLength(1)
  })

  it('共有シートを閉じただけ（Share canceled）なら、失敗にしない', async () => {
    calls.shareError = { message: 'Share canceled' }
    await expect(shareFileNative(new File(['v'], 'a.mp4'))).resolves.toBeUndefined()
  })

  it('ほかの失敗は、そのまま投げる', async () => {
    calls.shareError = new Error('only file urls are supported')
    await expect(shareFileNative(new File(['v'], 'a.mp4'))).rejects.toThrow('only file urls')
  })
})

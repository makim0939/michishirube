/**
 * 文字列の SHA-256（16進数）。サーバーとアプリで同じ値を作るために、ここに置く。
 * Sign in with Apple の nonce は、アプリが Apple に渡す値（この SHA-256）と、サーバーが元の値から作る値を、照らし合わせる
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

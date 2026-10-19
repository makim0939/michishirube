import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
// 1.0 と 1.0.0 は同じ版として数える
const normalize = (v: string) => v.replace(/(\.0)+$/, '')

describe('アプリの版（docs/versioning.md）', () => {
  const version = (JSON.parse(read('../package.json')) as { version: string }).version

  it('package.json の版は、x.y.z の形', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('iOS の MARKETING_VERSION（Debug・Release とも）が、package.json の版とそろっている', () => {
    const versions = [...read('../ios/App/App.xcodeproj/project.pbxproj').matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map((m) => m[1])
    expect(versions.length).toBeGreaterThan(0)
    for (const v of versions) expect(normalize(v)).toBe(normalize(version))
  })

  it('Android の versionName が、package.json の版とそろっている', () => {
    const m = read('../android/app/build.gradle').match(/versionName "([\d.]+)"/)
    expect(m).not.toBeNull()
    expect(normalize(m![1])).toBe(normalize(version))
  })
})

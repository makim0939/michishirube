// リリースの版を、検査して、package.json と iOS の MARKETING_VERSION に書く（.github/workflows/testflight.yml から呼ぶ）。
// 使い方：VERSION=1.2.0 node scripts/release-version.mjs check|bump
// 入力は環境変数で受ける（シェルに直接埋め込まない）
import { readFileSync, writeFileSync } from 'node:fs'

const PKG = 'package.json'
const PBX = 'ios/App/App.xcodeproj/project.pbxproj'
const next = process.env.VERSION ?? ''
const mode = process.argv[2]

const fail = (msg) => {
  console.error(`::error::${msg}`)
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+$/.test(next)) fail('版は X.Y.Z（数字だけ）の形で入れてください')

const pkgText = readFileSync(PKG, 'utf8')
const current = JSON.parse(pkgText).version
const parts = (v) => v.split('.').map(Number)
const isGreater = (a, b) => {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

if (mode === 'check') {
  if (!isGreater(next, current)) fail(`版 ${next} は、いまの版 ${current} より大きくありません`)
  console.log(`${current} → ${next}`)
} else if (mode === 'bump') {
  // JSON を作り直さず、version の行だけ置き換える（整形を変えない）
  const pkg = pkgText.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`)
  const pbxText = readFileSync(PBX, 'utf8')
  const count = (pbxText.match(/MARKETING_VERSION = [\d.]+;/g) ?? []).length
  if (count < 2) fail(`MARKETING_VERSION が ${count} か所しかありません（Debug・Release の 2 か所が要ります）`)
  writeFileSync(PKG, pkg)
  writeFileSync(PBX, pbxText.replace(/MARKETING_VERSION = [\d.]+;/g, `MARKETING_VERSION = ${next};`))
} else {
  fail('check か bump を指定してください')
}

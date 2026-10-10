import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../data/db'
import { activateSkill, getSettings, recordsOf } from '../data/repo'
import { getSyncConfig, getSyncStatus } from '../data/sync'
import { computeStates, sortByDepth } from '../domain/logic'
import { formatAgo } from './common'
import { useAction, useToast } from './feedback'
import { href } from './router'
import { readStorage, writeStorage } from './storage'

const HINT_KEY = 'michishirube:install-hint-dismissed'

function InstallHint() {
  const [hidden, setHidden] = useState(() => readStorage('local', HINT_KEY) === '1')
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  // iPadOS の Safari は Mac として名乗るので、タッチ対応かどうかでも判定する
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  if (hidden || standalone || !ios) return null
  return (
    <div className="notice">
      <p>
        <strong>ホーム画面に追加してください。</strong>
        Safari で開いたままだと、しばらく使わないうちに記録が消えることがあります。共有ボタン →「ホーム画面に追加」から開くと消えにくくなります。
      </p>
      <button
        className="btn small"
        onClick={() => {
          writeStorage('local', HINT_KEY, '1')
          setHidden(true)
        }}
      >
        閉じる
      </button>
    </div>
  )
}

/** 記録が端末にしか無いときや、同期・アップロードが止まっているときに知らせる */
function SyncBanner() {
  const data = useLiveQuery(async () => ({
    config: await getSyncConfig(),
    status: await getSyncStatus(),
    uploads: await db.media.where('upload').anyOf('pending', 'uploading').count(),
    failed: await db.media.where('upload').equals('failed').count(),
    records: await db.records.count(),
  }))
  if (!data) return null
  if (!data.config) {
    if (data.records === 0) return null
    return (
      <div className="notice">
        <p>
          <strong>記録はまだこの端末にしかありません。</strong>
          スマホの空きが少ないと消えることがあるので、クラウド同期をつないでください。
        </p>
        <a className="btn small" href={href('/settings')}>
          設定
        </a>
      </div>
    )
  }
  if (data.status.error) {
    return (
      <div className="notice">
        <p>
          <strong>同期できていません。</strong>
          {data.status.error}
        </p>
        <a className="btn small" href={href('/settings')}>
          設定
        </a>
      </div>
    )
  }
  if (data.uploads > 0 || data.failed > 0) {
    return (
      <p className="muted small">
        {data.uploads > 0 && `YouTube へのアップ待ちの動画が ${data.uploads} 本あります（アプリを開いている間に上げます）。`}
        {data.failed > 0 && `アップに失敗した動画が ${data.failed} 本あります。次に開いたときに上げ直します。`}
      </p>
    )
  }
  return null
}

export function TodayScreen() {
  const run = useAction()
  const toast = useToast()
  const data = useLiveQuery(async () => {
    const [skills, domains, settings] = await Promise.all([
      db.skills.toArray(),
      db.domains.orderBy('order').toArray(),
      getSettings(),
    ])
    const states = computeStates(skills)
    const active = skills
      .filter((s) => s.status === 'active')
      .sort((a, b) => (a.activatedAt ?? 0) - (b.activatedAt ?? 0))
    // 挑戦中のスキルの記録だけを読む（新しい順）
    const cards = await Promise.all(
      active.map(async (s) => {
        const records = await recordsOf(s.id)
        const next = records.find((r) => r.nextAction)
        return {
          skill: s,
          next: next && { text: next.nextAction, at: next.createdAt },
          count: records.length,
          last: records[0]?.createdAt ?? 0,
        }
      }),
    )
    const available = sortByDepth(skills.filter((s) => states.get(s.id) === 'available'))
    return { domains, settings, cards, available, total: skills.length }
  })

  if (!data) return null
  const domainName = new Map(data.domains.map((d) => [d.id, d.name]))
  const room = data.settings.maxActive - data.cards.length

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>今日の練習</h1>
        <span className="pill">
          挑戦中 {data.cards.length} / {data.settings.maxActive}
        </span>
      </header>

      <InstallHint />
      <SyncBanner />

      {data.cards.length === 0 && data.total > 0 ? (
        <div className="empty">
          <p>挑戦中のスキルがありません。</p>
          {data.available.length > 0 ? (
            <p className="muted">下の「挑戦できるスキル」から選ぶと、ここに練習カードが出ます。</p>
          ) : (
            <>
              <p className="muted">いま挑戦できるスキルもありません。ロードマップに次のスキルを足しましょう。</p>
              <a className="btn primary" href={href('/map')}>
                ロードマップを開く
              </a>
            </>
          )}
        </div>
      ) : (
        <ul className="cards">
          {data.cards.map(({ skill, next, count, last }) => (
            <li key={skill.id}>
              <a className="practice-card" href={href(`/record/${skill.id}`)}>
                <span className="card-domain">{domainName.get(skill.domainId)}</span>
                <span className="card-title">{skill.name}</span>
                <span className={`next-action ${next ? '' : 'none'}`}>
                  <span className="next-label">前回の次の一手</span>
                  <span className="next-text">{next ? next.text : 'まだありません。今日の記録で書きましょう'}</span>
                </span>
                <span className="card-footer">
                  <span className="muted">{count > 0 ? `記録 ${count}件・最後は${formatAgo(last)}` : '記録なし'}</span>
                  <span className="card-cta">記録する →</span>
                </span>
              </a>
              <a className="card-sub-link" href={href(`/skill/${skill.id}`)}>
                達成条件と過去の記録を見る
              </a>
            </li>
          ))}
        </ul>
      )}

      {data.available.length > 0 && room <= 0 && (
        <p className="muted small">
          ほかに挑戦できるスキルが {data.available.length} つあります。挑戦中は {data.settings.maxActive}{' '}
          つまでなので、いまのスキルを達成するか挑戦をやめると選べます。
        </p>
      )}

      {data.available.length > 0 && room > 0 && (
        <section className="section">
          <h2>挑戦できるスキル</h2>
          <ul className="list">
            {data.available.map((s) => (
              <li key={s.id} className="list-row">
                <a href={href(`/skill/${s.id}`)} className="list-main">
                  <span className="list-sub">{domainName.get(s.domainId)}</span>
                  <span>{s.name}</span>
                </a>
                <button
                  className="btn small primary"
                  onClick={() =>
                    run(async () => {
                      await activateSkill(s.id)
                      toast.show(`「${s.name}」に挑戦します`)
                    })
                  }
                >
                  挑戦する
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.total === 0 && (
        <div className="empty">
          <p>ロードマップがありません。</p>
          <a className="btn primary" href={href('/map')}>
            ロードマップを作る
          </a>
        </div>
      )}
    </div>
  )
}

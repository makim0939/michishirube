import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db } from '../data/db'
import { BUNDLED_TEMPLATES, createDomain, deleteDomain, importTemplate, renameDomain } from '../data/repo'
import { sortByDepth } from '../domain/logic'
import { entitiesToTemplate } from '../domain/template'
import type { Domain } from '../domain/types'
import { ConfirmButton, saveFile } from './common'
import { useAction, useToast } from './feedback'
import { PlusIcon } from './icons'
import { go } from './router'

/**
 * 設定の「ロードマップ」。用意されているロードマップを入れる・JSON で読み書きする・分野を足す・名前を変える・消す。
 * ふだんの型の画面には出さず、ここにまとめる（使うことは少ないので）
 */
export function RoadmapSettings() {
  const run = useAction()
  const toast = useToast()
  const importInput = useRef<HTMLInputElement>(null)
  const [addingDomain, setAddingDomain] = useState(false)
  const data = useLiveQuery(async () => {
    const [domains, skills] = await Promise.all([db.domains.orderBy('order').toArray(), db.skills.toArray()])
    return { domains, skills }
  })
  if (!data) return null

  const onImport = async (file: File | undefined) => {
    if (!file) return
    const id = await run(async () => {
      let json: unknown
      try {
        json = JSON.parse(await file.text())
      } catch {
        throw new Error('JSON として読み込めませんでした')
      }
      return importTemplate(json)
    })
    if (id) {
      toast.show('ロードマップを読み込みました')
      go(`/map/${id}`)
    }
  }

  return (
    <>
      <section className="section">
        <h2>分野</h2>
        <ul className="list">
          {data.domains.map((d) => (
            <DomainRow key={d.id} domain={d} count={data.skills.filter((s) => s.domainId === d.id).length} />
          ))}
        </ul>
        {addingDomain ? (
          <NewDomainForm onDone={() => setAddingDomain(false)} />
        ) : (
          <button className="btn" onClick={() => setAddingDomain(true)}>
            <PlusIcon size={18} />
            分野を追加（ピアノなど）
          </button>
        )}
      </section>

      <section className="section">
        <h2>用意されているロードマップ</h2>
        <ul className="list">
          {BUNDLED_TEMPLATES.map((t) => (
            <li key={t.domain} className="list-row">
              <span className="list-main">
                <span>{t.domain}</span>
                <span className="list-sub">型 {t.skills.length}</span>
              </span>
              <button
                className="btn small"
                onClick={async () => {
                  const id = await run(() => importTemplate(t))
                  if (id) {
                    toast.show(
                      data.domains.some((d) => d.name === t.domain)
                        ? `「${t.domain}」をもう1つ追加しました`
                        : `「${t.domain}」を追加しました`,
                    )
                    go(`/map/${id}`)
                  }
                }}
              >
                追加
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>JSON から読み込む</h2>
        <button className="btn" onClick={() => importInput.current?.click()}>
          ロードマップの JSON を読み込む
        </button>
        <input
          ref={importInput}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            void onImport(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <p className="muted small">新しい分野として追加されます。形式は README を参照してください。</p>
      </section>
    </>
  )
}

/** 分野1つ。押すと、名前を変える・JSON で書き出す・消す */
function DomainRow({ domain, count }: { domain: Domain; count: number }) {
  const run = useAction()
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  return (
    <li className="list-row domain-row">
      <button type="button" className="list-main domain-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{domain.name}</span>
        <span className="list-sub">型 {count}</span>
      </button>
      {open && (
        <div className="stack domain-actions">
          {renaming !== null ? (
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault()
                const ok = await run(async () => {
                  await renameDomain(domain.id, renaming)
                  return true
                })
                // 失敗したときは入力を残して、その場で直せるようにする
                if (ok) setRenaming(null)
              }}
            >
              <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} />
              <button className="btn small primary" type="submit">
                保存
              </button>
            </form>
          ) : (
            <button className="btn small" onClick={() => setRenaming(domain.name)}>
              名前を変える
            </button>
          )}
          <button
            className="btn small"
            onClick={() =>
              run(async () => {
                const skills = sortByDepth(await db.skills.where('domainId').equals(domain.id).toArray())
                const json = JSON.stringify(entitiesToTemplate(domain, skills), null, 2)
                await saveFile(new Blob([json], { type: 'application/json' }), `roadmap-${domain.name}.json`)
              })
            }
          >
            JSON で書き出す
          </button>
          <ConfirmButton
            className="btn small ghost"
            confirmLabel="削除する"
            message={`「${domain.name}」の型と、記録・動画・写真をすべて削除します。元に戻せません。`}
            onConfirm={() => run(() => deleteDomain(domain.id))}
          >
            削除
          </ConfirmButton>
        </div>
      )}
    </li>
  )
}

function NewDomainForm({ onDone }: { onDone: () => void }) {
  const run = useAction()
  const [name, setName] = useState('')
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const id = await run(() => createDomain(name))
        if (id) {
          onDone()
          go(`/map/${id}`)
        }
      }}
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="分野の名前（例：ピアノ）" />
      <button className="btn small primary" type="submit">
        作る
      </button>
      <button className="btn small" type="button" onClick={onDone}>
        やめる
      </button>
    </form>
  )
}

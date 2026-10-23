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
import { t } from '../i18n'

/**
 * 設定の「ロードマップ」。用意されているロードマップを入れる・ファイルで読み書きする・分野を足す・名前を変える・消す。
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
        throw new Error(t.roadmap.readFailed)
      }
      return importTemplate(json)
    })
    if (id) {
      toast.show(t.roadmap.imported)
      go(`/map/${id}`)
    }
  }

  return (
    <>
      <section className="section">
        <h2>{t.map.domains}</h2>
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
            {t.roadmap.addDomain}
          </button>
        )}
      </section>

      <section className="section">
        <h2>{t.roadmap.bundled}</h2>
        <ul className="list">
          {BUNDLED_TEMPLATES.map((tpl) => (
            <li key={tpl.domain} className="list-row">
              <span className="list-main">
                <span>{tpl.domain}</span>
                <span className="list-sub">{t.roadmap.skillCount(tpl.skills.length)}</span>
              </span>
              <button
                className="btn small"
                onClick={async () => {
                  const id = await run(() => importTemplate(tpl))
                  if (id) {
                    toast.show(
                      data.domains.some((d) => d.name === tpl.domain)
                        ? t.roadmap.addedAgain(tpl.domain)
                        : t.roadmap.added(tpl.domain),
                    )
                    go(`/map/${id}`)
                  }
                }}
              >
                {t.roadmap.add}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>{t.roadmap.fromFile}</h2>
        <button className="btn" onClick={() => importInput.current?.click()}>
          {t.roadmap.importFile}
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
      </section>
    </>
  )
}

/** 分野1つ。押すと、名前を変える・ファイルに書き出す・消す */
function DomainRow({ domain, count }: { domain: Domain; count: number }) {
  const run = useAction()
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  return (
    <li className="list-row domain-row">
      <button type="button" className="list-main domain-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{domain.name}</span>
        <span className="list-sub">{t.roadmap.skillCount(count)}</span>
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
                {t.record.saveShort}
              </button>
            </form>
          ) : (
            <button className="btn small" onClick={() => setRenaming(domain.name)}>
              {t.roadmap.rename}
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
            {t.roadmap.export}
          </button>
          <ConfirmButton
            className="btn small ghost"
            confirmLabel={t.common.delete}
            message={t.roadmap.deleteMessage(domain.name)}
            onConfirm={() => run(() => deleteDomain(domain.id))}
          >
            {t.refs.remove}
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
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t.roadmap.domainPlaceholder} />
      <button className="btn small primary" type="submit">
        {t.roadmap.create}
      </button>
      <button className="btn small" type="button" onClick={onDone}>
        {t.common.cancel}
      </button>
    </form>
  )
}

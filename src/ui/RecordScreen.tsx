import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { canJoinVideos } from '../data/compose'
import { contentBlob } from '../data/content'
import { loadProducts, mayCompose, noteComposeUse } from '../data/purchases'
import { db } from '../data/db'
import { compressPhoto, inMemory, makePoster, type Poster } from '../data/mediaPrep'
import { addRecord, deleteRecord, lastNextAction, updateRecord, type NewMedia } from '../data/repo'
import { getVideoSettings, type VideoQuality, type YoutubePrivacy } from '../data/videoStorage'
import { isAndroidApp } from '../platform'
import { causeTip, LATTE_CAUSES } from '../domain/causes'
import { OUTCOME_LABEL } from '../domain/format'
import { sortByDepth } from '../domain/logic'
import type { Media, Outcome } from '../domain/types'
import { ConfirmButton, Empty, formatBytes, isVideo, MediaView, requestPersist, splitName } from './common'
import { useCupImageUrl } from './cupImage'
import { toastDuration, useAction, useToast } from './feedback'
import { canRecordInApp, Recorder } from './Recorder'
import { backHandler, go, goBack, href } from './router'
import { expireUndo, undoAll, undoLast, type UndoState } from './removedStack'
import { readStorage, removeStorage, writeStorage } from './storage'
import { SkillPicker } from './SkillPicker'
import { Composer, type ComposerClip } from './Composer'
import { Trimmer } from './Trimmer'
import { recordBackAction } from './recordBack'
import { useBackHandler } from './useBackHandler'
import { patternFor } from './world'
import { BackIcon, CameraIcon, ChevronDownIcon, FilmIcon, PhotoIcon, PlusIcon, ScissorsIcon, VideoIcon } from './icons'
import { t } from '../i18n'

const OUTCOMES: { value: Outcome; label: string }[] = (['good', 'meh', 'bad'] as const).map((value) => ({
  value,
  label: OUTCOME_LABEL[value],
}))

// 書きかけのメモは、カメラから戻ったときにページが再読み込みされても残るようにする
// skillId は、記録の途中で選び直した型（route の型と違うとき）
/** 記録の画面で「うまくいかなかった原因」のタグを選べるようにするか */
const SHOW_CAUSE_INPUT = false

type Draft = { skillId?: string; reason?: string; nextAction?: string; causes?: string[] }

function useDraft(key: string, enabled: boolean) {
  const [draft, setDraft] = useState<Draft>(() => {
    if (!enabled) return {}
    try {
      return JSON.parse(readStorage('session', key) ?? '{}') as Draft
    } catch {
      return {}
    }
  })
  useEffect(() => {
    if (enabled) writeStorage('session', key, JSON.stringify(draft))
  }, [key, draft, enabled])
  return [draft, setDraft, () => removeStorage('session', key)] as const
}

/** 編集で、端末に中身が無い動画・写真。写真はサーバーから取り、YouTube にある動画はその絵と、編集できないことを出す */
function NotOnDevice({ media }: { media: Media }) {
  const url = useCupImageUrl(media, 'edit')
  if (!url) return <div className="media placeholder">{t.common.notOnDevice}</div>
  if (!isVideo(media)) return <img className="media" src={url} alt="" />
  return (
    <div className="media placeholder with-poster" style={{ backgroundImage: `url(${url})` }}>
      {media.youtubeId ? t.record.onYoutube : t.common.notOnDevice}
      <small>{t.record.cannotEdit}</small>
    </div>
  )
}

/** 画面に並べる動画・写真。新しく撮ったものと、保存済みの記録にあるもの */
type Item =
  | {
      kind: 'new'
      key: string
      file: File
      poster?: Poster
      inMemory: boolean
      /** アプリのカメラで撮ったときの画質（アルバムから入れた動画は無い） */
      quality?: VideoQuality
      /** この動画だけ、YouTube に上げる公開範囲を変えたとき（変えなければ、設定のとおり） */
      privacy?: YoutubePrivacy
    }
  | { kind: 'existing'; key: string; media: Media; replaced?: { file: File; poster?: Poster } }

function itemBlob(item: Item): Blob | undefined {
  if (item.kind === 'new') return item.file
  return item.replaced?.file ?? item.media.blob
}

function itemType(item: Item): string {
  return item.kind === 'new' ? item.file.type : (item.replaced?.file.type ?? item.media.type)
}

/** File をメモリ上のコピーにする（名前と種類は残す） */
async function detach(file: File): Promise<File> {
  return new File([await inMemory(file)], file.name, { type: file.type })
}

/** Android でアルバムから入れられる動画の大きさ（4K でも1分ほど）。超えるとメモリに写すときにアプリが落ちることがある */
const ANDROID_MAX_PICK_BYTES = 400 * 1024 * 1024

let keySeq = 0
const nextKey = () => `item-${++keySeq}`

/** 「元に戻す」のトーストが出ている長さ。積みを捨てる時間も、これに合わせる */
const UNDO_MS = toastDuration(t.record.removed, 'ok', true)

/**
 * 記録する画面。recordId があれば、保存した記録を編集する
 */
export function RecordScreen({ skillId: routeSkillId, recordId }: { skillId: string; recordId?: string }) {
  const editing = !!recordId
  const run = useAction()
  const toast = useToast()
  /** 外した動画・写真（外した順）。保存に成功するか、時間が切れるまで持つ */
  const [undo, setUndo] = useState<UndoState<Item>>({ stack: [], at: 0 })
  /** 押された時・保存に失敗した時に、最新の積みと保存中かを読むための写し */
  const undoRef = useRef(undo)
  undoRef.current = undo
  /** いま出ている「元に戻す」のトーストの key */
  const undoToast = useRef<number | null>(null)
  const hideUndoToast = () => {
    if (undoToast.current !== null) toast.hide(undoToast.current)
    undoToast.current = null
  }
  /** 保存に成功したら、外した物は不要（「もう1杯」で画面が残っても、次の記録に持ち越さない） */
  const dropUndo = () => {
    hideUndoToast()
    undoRef.current = { stack: [], at: 0 }
    setUndo(undoRef.current)
  }
  // 画面を離れるとき、押しても効かなくなる「元に戻す」のトーストを消す
  useEffect(() => () => hideUndoToast(), [])
  // トーストが消える頃に、積みも捨てる。積みが変わるたび（外す・戻す）に、測り直す
  useEffect(() => {
    if (undo.stack.length === 0) return
    const timer = setTimeout(() => setUndo((cur) => expireUndo(cur, Date.now(), UNDO_MS)), UNDO_MS + 50)
    return () => clearTimeout(timer)
  }, [undo])
  const videoSettings = useLiveQuery(getVideoSettings)
  const storage = videoSettings?.storage
  // 型は、同じ分野の中から選び直せる（練習の途中で、描く型を変えることがある）
  const skills = useLiveQuery(async () => {
    const first = await db.skills.get(routeSkillId)
    return first ? sortByDepth(await db.skills.where('domainId').equals(first.domainId).toArray()) : []
  }, [routeSkillId])
  const [draft, setDraft, clearDraft] = useDraft(`michishirube:draft:${routeSkillId}`, !editing)
  // 下書きの型が、もう無いとき（削除・同期で消えた）は、URL の型に戻す（画面から抜けられなくならないように）
  const skillId = draft.skillId && skills?.some((s) => s.id === draft.skillId) ? draft.skillId : routeSkillId
  const skill = skills?.find((s) => s.id === skillId)
  const stats = useLiveQuery(
    async () => ({
      next: !editing ? await lastNextAction(skillId) : undefined,
      count: await db.records.where('skillId').equals(skillId).count(),
    }),
    [skillId, editing],
  )
  // 型を選び直した瞬間に、画面が空にならないよう、読み直しの間は前の値を使う
  const lastStats = useRef(stats)
  if (stats) lastStats.current = stats
  const shownStats = stats ?? lastStats.current
  const data = skills && shownStats ? { skills, ...shownStats } : undefined
  // 直す記録の、もとの型（保存したときに、型を変えたか調べるため。URL の型は、履歴の古い URL だと違うことがある）
  const originalSkillId = useRef<string | undefined>(undefined)
  // 型だけを選んで何も書かずに離れたら、その選びは残さない（次に同じ型の記録を開いたとき、別の型で開いてしまうため）。
  // ページの再読み込み（カメラから戻るとき）では、この後始末は走らないので、書きかけは残る
  const latestDraft = useRef(draft)
  latestDraft.current = draft
  useEffect(
    () => () => {
      const d = latestDraft.current
      if (!editing && !d.reason?.trim() && !d.nextAction?.trim() && !(d.causes?.length ?? 0)) {
        removeStorage('session', `michishirube:draft:${routeSkillId}`)
      }
    },
    [editing, routeSkillId],
  )

  const [items, setItems] = useState<Item[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [outcome, setOutcome] = useState<Outcome>()
  const [loaded, setLoaded] = useState(!editing)
  const [missing, setMissing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  savingRef.current = saving
  /**
   * 撮った・選んだのに、まだ一覧に入っていない動画・写真の数（写真の縮小や、Android でメモリに写している途中）。
   * この間に保存すると、その動画・写真の無い記録になってしまうので、保存は入り終わるのを待つ。戻るときも、撮ったものとして確認を出す
   */
  const [preparing, setPreparing] = useState(0)
  /** 入り終わるのを待っている保存（「もう1杯」か）。待っていなければ null */
  const queuedSave = useRef<boolean | null>(null)
  const saveRef = useRef<(more: boolean) => unknown>(undefined)
  /** 前に入れ始めた動画・写真が一覧に入り終わる時。入れ始めた順に並べるため、後から始めたものは、これを待ってから入れる */
  const prepChain = useRef<Promise<unknown>>(Promise.resolve())
  /** 保存せずに離れようとしたときの行き先（null なら確認を出していない） */
  const [confirmLeave, setConfirmLeave] = useState<{ back: true } | { to: string } | null>(null)
  const [recording, setRecording] = useState(false)
  const [trimming, setTrimming] = useState<string | null>(null)
  /** 「つなぐ」の画面を開いている */
  const [joining, setJoining] = useState(false)
  const [pickingSkill, setPickingSkill] = useState(false)
  const videoInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  /** 理由のメモ欄を開いている（書いてあれば最初から開く） */
  const [memoOpen, setMemoOpen] = useState(false)
  const autoOpened = useRef(false)

  // 新しく記録するときは、すぐカメラを開く（撮ってから結果を付ける。注ぐ前に見たい「次の一手」はカメラの上に出す）
  useEffect(() => {
    if (editing || autoOpened.current || !skill) return
    autoOpened.current = true
    if (canRecordInApp()) setRecording(true)
  }, [editing, skill])

  // 直すときは、保存した内容を一度だけ読み込む（同期で書き換わっても、入力中の内容を上書きしない）
  useEffect(() => {
    if (!recordId) return
    let cancelled = false
    void (async () => {
      const record = await db.records.get(recordId)
      if (cancelled) return
      if (!record) {
        setMissing(true)
        return
      }
      const rows = (await db.media.bulkGet(record.mediaIds)).filter((m): m is Media => !!m)
      // アプリでは中身がファイルにあるので、切り取りなどで使えるよう読み込んでおく（保存はしない）
      const media = await Promise.all(
        rows.map(async (m) => (m.file && !m.blob ? { ...m, blob: await contentBlob(m).catch(() => undefined) } : m)),
      )
      if (cancelled) return
      originalSkillId.current = record.skillId
      setOutcome(record.outcome)
      setDraft({ skillId: record.skillId, reason: record.reason, nextAction: record.nextAction, causes: record.causes })
      setItems(media.map((m) => ({ kind: 'existing' as const, key: nextKey(), media: m })))
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [recordId, setDraft])

  // 結果・原因・次の一手・メモのどれかを入れてある（空白だけは入れていないのと同じ。保存の条件と同じ数え方）
  const hasInput =
    !!outcome || !!draft.reason?.trim() || !!draft.nextAction?.trim() || (draft.causes?.length ?? 0) > 0
  // 新しい記録は、動画・写真か入力が1つでもあれば残す価値がある（無いまま戻ると何も失わない）
  // 外して、まだ「元に戻す」で戻せる新しい動画・写真（外しただけで、画面を離れると、戻せなくなる）
  const removedNew = undo.stack.filter((r) => r.item.kind === 'new').length
  const unsaved = preparing > 0 || (editing ? dirty : items.length > 0 || hasInput || removedNew > 0)

  /** 保存前の内容があれば、黙って離れずに確認を出す（出したら true。false なら、そのまま離れてよい） */
  const askBeforeLeaving = () => {
    if (!unsaved) return false
    setConfirmLeave({ back: true })
    return true
  }

  // 入り終わるのを待っていた保存を、入ったあとの一覧で続ける
  useEffect(() => {
    if (preparing > 0 || queuedSave.current === null) return
    const more = queuedSave.current
    queuedSave.current = null
    void saveRef.current?.(more)
  }, [preparing])
  // 画面を離れたら、待っていた保存はやめる（「保存せずに戻る」を選んだあとに、保存されてしまわないように）
  useEffect(
    () => () => {
      queuedSave.current = null
    },
    [],
  )

  // Android の「戻る」（ボタン・端からのスワイプ）も、画面の「<」と同じく確認を通す。
  // 確認が出ているときの「戻る」は、確認を閉じて続ける。カメラ・編集・型の選択は、それぞれが先に受け止める
  useBackHandler(() => {
    const action = recordBackAction({ saving, confirming: !!confirmLeave, unsaved })
    if (action === 'closeConfirm') setConfirmLeave(null)
    if (action === 'askConfirm') setConfirmLeave({ back: true })
    return action !== 'leave'
  })

  if (!data || !loaded) return missing ? <Empty>{t.common.recordNotFound}</Empty> : null
  const { next, count } = data
  if (!skill) return <Empty>{t.common.skillNotFound}</Empty>

  const fallback = editing ? `/skill/${skillId}` : '/'
  // 原因のタグは、いまは出さない（記録の画面がごちゃつく・あまり使われないため）。
  // あとで、利用者が自分で決められる形にして戻すときは、SHOW_CAUSE_INPUT を true にする（これまでの記録の原因は、残っていて、記録の詳細に出る）
  const causeOptions: readonly string[] = SHOW_CAUSE_INPUT && patternFor(skill.name) ? LATTE_CAUSES : []
  const hasNewMedia = items.some((i) => i.kind === 'new' || (i.kind === 'existing' && i.replaced))
  // 新しい記録で、まだ何も無い（保存しても「何か入れてください」になるだけなので、押せないようにする）
  const nothingToSave = !editing && items.length === 0 && preparing === 0 && !hasInput

  const change = () => setDirty(true)

  /** 型を選び直す。原因の選択肢は型ごとなので、選べなくなる型へ移るときは、選んでいた原因を外す */
  const pickSkill = (id: string) => {
    setPickingSkill(false)
    if (id === skillId) return
    const target = skills?.find((s) => s.id === id)
    setDraft((d) => ({ ...d, skillId: id, ...(target && patternFor(target.name) ? {} : { causes: undefined }) }))
    change()
  }

  /** 動画のサムネイルは後から作って付ける（撮ってすぐ一覧に出す） */
  const attachPoster = (key: string, file: File) => {
    void makePoster(file).then((poster) => {
      if (!poster) return
      setItems((prev) =>
        prev.map((i) => {
          if (i.key !== key) return i
          if (i.kind === 'new' && i.file === file) return { ...i, poster }
          if (i.kind === 'existing' && i.replaced?.file === file) return { ...i, replaced: { file, poster } }
          return i
        }),
      )
    })
  }

  /** inMemory：アプリ内の録画のように、もともとメモリ上にあるファイル */
  const addFiles = async (list: FileList | File[] | null, inMemory = false, quality?: VideoQuality) => {
    // FileList は input の value を空にすると中身も消えるので、先に配列へ写す
    let picked = list ? Array.from(list) : []
    // Android はメモリに写すので、大きすぎる動画は入れない（アプリが落ちないように）
    if (isAndroidApp && picked.some((f) => f.type.startsWith('video/') && f.size > ANDROID_MAX_PICK_BYTES)) {
      picked = picked.filter((f) => !(f.type.startsWith('video/') && f.size > ANDROID_MAX_PICK_BYTES))
      toast.show(t.record.tooLong, 'error')
    }
    if (picked.length === 0) return
    setPreparing((n) => n + picked.length)
    try {
      // 写真は縮小してから持つ（端末の容量と同期の量を抑える）。
      // Android は、選んだファイルを少したつと読めなくなる（読む許可が切れる）ので、動画もすぐメモリに写す。
      // 1つ読めなくても、ほかの動画・写真は入れる（撮り直さずに済むように）
      // 準備は並んで進めてよいが、一覧に入れるのは入れ始めた順（大きな動画の後に撮った写真が、先に並ばないように）
      const work = Promise.allSettled(
        picked.map((f) => (f.type.startsWith('image/') ? compressPhoto(f) : isAndroidApp ? detach(f) : f)),
      )
      const ready = prepChain.current.then(() => work)
      prepChain.current = ready
      const settled = await ready
      // 縮小した写真もメモリ上に作り直したもの
      const added = settled.flatMap((r, i) =>
        r.status === 'fulfilled'
          ? [
              {
                kind: 'new' as const,
                key: nextKey(),
                file: r.value,
                inMemory: inMemory || r.value !== picked[i],
                // 撮った画質は、動画だけに付ける
                ...(quality && r.value.type.startsWith('video/') ? { quality } : {}),
              },
            ]
          : [],
      )
      if (added.length > 0) {
        setItems((prev) => [...prev, ...added])
        change()
      }
      for (const a of added) if (a.file.type.startsWith('video/')) attachPoster(a.key, a.file)
      if (added.length < picked.length) {
        // 待っていた保存はやめる（入らなかったものに気づかないまま、欠けた記録を残さないように）
        if (queuedSave.current !== null) {
          queuedSave.current = null
          setSaving(false)
        }
        throw new Error(t.record.unreadable)
      }
    } finally {
      setPreparing((n) => n - picked.length)
    }
  }

  /**
   * 動画・写真を外す。撮り直しのできない動画を誤タップで失わないよう、確認ダイアログは出さず（手間を増やさず）、
   * 「元に戻す」のトーストを出す。続けて外したときは、押すたびに直近の物から戻す（トーストは1つのまま）
   */
  /** quiet：「外しました」のトーストを出さない（つないだとき、別のトーストを出すため） */
  const removeItem = (item: Item, quiet = false) => {
    const index = items.findIndex((i) => i.key === item.key)
    setItems((prev) => prev.filter((i) => i.key !== item.key))
    if (item.kind === 'existing') setRemoved((prev) => [...prev, item.media.id])
    change()
    // 時間が切れて戻せなくなった物は、次の「元に戻す」で急に出てこないよう、捨ててから積む
    const cur = expireUndo(undoRef.current, Date.now(), UNDO_MS)
    const next = { stack: [...cur.stack, { item, index }], at: Date.now() }
    undoRef.current = next
    setUndo(next)
    if (!quiet) showUndo()
  }

  const showUndo = () => {
    undoToast.current = toast.show(t.record.removed, 'ok', {
      label: t.record.undoRemove,
      onClick: () => {
        undoToast.current = null
        const cur = undoRef.current
        const last = cur.stack[cur.stack.length - 1]
        // 保存の最中は戻さない（保存する内容と、画面の並びが、ずれないように）
        if (!last || savingRef.current) return
        const { item } = last
        setItems((prev) => undoLast(prev, [last]).list)
        if (item.kind === 'existing') setRemoved((prev) => prev.filter((id) => id !== item.media.id))
        const rest = { stack: cur.stack.slice(0, -1), at: Date.now() }
        undoRef.current = rest
        setUndo(rest)
        // まだ外した物が残っていれば、続けて戻せるように、トーストを出し直す
        if (rest.stack.length > 0) showUndo()
      },
    })
  }

  /** 保存に失敗したとき：外した物をすべて戻す（外したまま、保存もできずに、失わないように） */
  const restoreRemoved = () => {
    const { stack } = undoRef.current
    if (stack.length === 0) return
    setItems((prev) => undoAll(prev, stack))
    const ids = stack.flatMap((r) => (r.item.kind === 'existing' ? [r.item.media.id] : []))
    if (ids.length > 0) setRemoved((prev) => prev.filter((id) => !ids.includes(id)))
    undoRef.current = { stack: [], at: 0 }
    setUndo(undoRef.current)
  }

  /** この動画だけ、YouTube に上げる公開範囲を切り替える（初めは設定のとおり） */
  const togglePrivacy = (item: Item) => {
    if (item.kind !== 'new') return
    const next: YoutubePrivacy = (item.privacy ?? videoSettings?.youtubePrivacy) === 'public' ? 'unlisted' : 'public'
    setItems((prev) => prev.map((i) => (i.key === item.key && i.kind === 'new' ? { ...i, privacy: next } : i)))
    change()
    toast.show(next === 'public' ? t.record.toastPublic : t.record.toastUnlisted)
  }

  const onTrimmed = (key: string, file: File) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.key !== key) return i
        return i.kind === 'new' ? { ...i, file, poster: undefined, inMemory: true } : { ...i, replaced: { file } }
      }),
    )
    setTrimming(null)
    change()
    attachPoster(key, file)
  }

  /** つなぐ動画（端末に中身があるもの）。並びは、画面の並びのまま */
  const joinable = canJoinVideos ? items.filter((i) => isVideo({ type: itemType(i) }) && !!itemBlob(i)) : []

  /** 画面は誰でも開ける。有料の操作（2 本以上をつなぐ・BGM）は、「完了」を押したときに、回数を見る */
  const mayUsePaid = async () => {
    const { plus } = await loadProducts()
    return mayCompose(!!plus)
  }

  /**
   * つないだ動画で置き換える。つないだ順の先頭の動画に、できあがりを入れ（保存済みなら、中身の差し替え）、
   * ほかの動画は外す。「元に戻す」で、つなぐ前（動画の並び）に戻せる（各範囲は、つなぎ直すときに決め直す）
   */
  const onJoined = (file: File, order: string[], paid: boolean) => {
    const [first, ...rest] = order
    const original = items.find((i) => i.key === first)
    const restItems = rest.flatMap((key) => items.find((i) => i.key === key) ?? [])
    setItems((prev) =>
      prev.map((i) => {
        if (i.key !== first) return i
        return i.kind === 'new' ? { ...i, file, poster: undefined, inMemory: true } : { ...i, replaced: { file, poster: undefined } }
      }),
    )
    // 外した動画も、保存に失敗したときに戻せるよう、外した物の積みに入れる（トーストは、つないだことを 1 回だけ出す）
    for (const item of restItems) removeItem(item, true)
    // 使わなかった動画（つなぐ画面で外したもの）は、そのまま残る
    setJoining(false)
    change()
    attachPoster(first, file)
    if (paid) void noteComposeUse()
    toast.show(t.compose.joined, 'ok', {
      label: t.record.undoRemove,
      onClick: () => {
        // 保存の最中は戻さない（保存する内容と、画面の並びが、ずれないように）
        if (!original || savingRef.current) return
        const keys = new Set(restItems.map((i) => i.key))
        const entries = undoRef.current.stack.filter((r) => keys.has(r.item.key))
        setItems((prev) =>
          undoAll(
            prev.map((i) => (i.key === first ? original : i)),
            entries,
          ),
        )
        const ids = restItems.flatMap((i) => (i.kind === 'existing' ? [i.media.id] : []))
        if (ids.length > 0) setRemoved((prev) => prev.filter((id) => !ids.includes(id)))
        const rest = { stack: undoRef.current.stack.filter((r) => !keys.has(r.item.key)), at: Date.now() }
        undoRef.current = rest
        setUndo(rest)
        change()
      },
    })
  }

  /** more：保存したら、続けて次の杯を撮る。動画・写真が入り終わる前に押したら、入るのを待ってから保存する */
  const save = (more = false) => {
    if (preparing > 0) {
      queuedSave.current = more
      setSaving(true)
      return
    }
    // 保存が済んだか。済まないまま終わったら（失敗）、外した物を戻す
    let saved = false
    const done = run(async () => {
      setSaving(true)
      try {
        const reason = draft.reason ?? ''
        const nextAction = draft.nextAction ?? ''
        // 原因は、△✕のときだけ選べる。書きかけから戻ったとき、結果だけ消えて原因が見えないまま残っても、保存はしない
        const causes = editing || outcome === 'meh' || outcome === 'bad' ? (draft.causes ?? []) : []
        const added: NewMedia[] = []
        const replace: ({ id: string } & NewMedia)[] = []
        for (const i of items) {
          // 切り取った動画は、もともとメモリ上にある
          if (i.kind === 'new')
            added.push({
              blob: i.inMemory ? i.file : await detach(i.file),
              poster: i.poster?.blob,
              posterEnd: i.poster?.end,
              quality: i.quality,
              youtubePrivacy: i.privacy,
            })
          else if (i.replaced)
            replace.push({
              id: i.media.id,
              blob: i.replaced.file,
              poster: i.replaced.poster?.blob,
              posterEnd: i.replaced.poster?.end,
            })
        }
        if (recordId) {
          await updateRecord({
            recordId,
            skillId,
            outcome,
            reason,
            causes,
            nextAction,
            addFiles: added,
            removeMediaIds: removed,
            replace,
          })
          saved = true
          dropUndo()
          toast.show(skillId === (originalSkillId.current ?? routeSkillId) ? t.record.saved : t.record.movedAndSaved(splitName(skill.name).main))
        } else {
          await addRecord({ skillId, outcome, reason, causes, nextAction, files: added })
          saved = true
          dropUndo()
          clearDraft()
          const total = await db.records.count()
          if (more) {
            // 続けて淹れる：この画面のまま中身を空にして、すぐカメラを開く
            toast.show(t.record.recorded(total))
            setItems([])
            setOutcome(undefined)
            // 型を変えて描き直したなら、続けて同じ型で撮ることが多いので、型は残す
            setDraft(skillId === routeSkillId ? {} : { skillId })
            setMemoOpen(false)
            window.scrollTo(0, 0)
            if (canRecordInApp()) setRecording(true)
            if (hasNewMedia) void requestPersist()
            return
          }
          toast.show(t.record.recorded(total), 'ok', { label: t.record.oneMore, onClick: () => go(`/record/${skillId}`) })
        }
        if (hasNewMedia) void requestPersist()
        goBack(fallback)
      } finally {
        setSaving(false)
      }
    })
    void done.then(() => {
      if (!saved) restoreRemoved()
    })
    return done
  }
  saveRef.current = save

  const trimItem = items.find((i) => i.key === trimming)
  const trimBlob = trimItem && itemBlob(trimItem)

  // 次の一手の候補：前回と同じ、選んだ原因の直し方（押すだけで入る）
  const suggestions = [
    ...(next && !editing ? [{ prefix: t.record.lastTime, text: next.text }] : []),
    ...(draft.causes ?? []).flatMap((c) => {
      const tip = causeTip(c)
      return tip ? [{ prefix: c, text: tip }] : []
    }),
  ].filter((sgt, i, all) => all.findIndex((x) => x.text === sgt.text) === i && sgt.text !== draft.nextAction)
  const showMemo = memoOpen || !!draft.reason
  const openCamera = () => (canRecordInApp() ? setRecording(true) : videoInput.current?.click())

  return (
    <div className="screen record-screen">
      <header className="screen-header">
        <a
          className="back"
          href={href(fallback)}
          onClick={(e) => {
            // 撮った動画・写真や直した内容は、ここで保存しないと消えるので、黙って戻らない
            if (askBeforeLeaving()) e.preventDefault()
            else backHandler(fallback)(e)
          }}
          aria-label={t.common.back}
        >
          <BackIcon size={26} />
        </a>
        <div className="title-block">
          {editing ? <span className="muted">{t.record.editTitle}</span> : <span className="muted">{t.record.nth(count + 1)}</span>}
          <h1>
            {/* 同じ分野に別の型があるときは、名前を押して選び直せる（ボタンを足さずに、見出しに寄せる） */}
            {skills && skills.length > 1 ? (
              <button
                type="button"
                className="title-switch"
                aria-label={t.record.changeSkill(splitName(skill.name).main)}
                aria-haspopup="dialog"
                onClick={() => setPickingSkill(true)}
              >
                {splitName(skill.name).main}
                <ChevronDownIcon size={18} />
              </button>
            ) : (
              splitName(skill.name).main
            )}
          </h1>
        </div>
      </header>

      {confirmLeave && (
        <div className="confirm">
          <p>
            {editing
              ? t.record.leaveEdited
              : items.length + preparing + removedNew > 0
                ? t.record.leaveMedia(items.length + preparing + removedNew)
                : t.record.leaveInput}
          </p>
          <div className="row">
            <button
              className="btn danger"
              onClick={() => {
                // 「保存せずに戻る」と選んだ書きかけは、次に開いたときに現れないよう消す
                if (!editing) clearDraft()
                // 動画・写真が入り終わるのを待っていた保存も、やめる
                queuedSave.current = null
                if ('to' in confirmLeave) go(confirmLeave.to)
                else goBack(fallback)
              }}
            >
              {'to' in confirmLeave ? t.record.leaveMove : t.record.leaveBack}
            </button>
            <button className="btn" onClick={() => setConfirmLeave(null)}>
              {editing ? t.record.keepEditing : t.record.keepRecording}
            </button>
          </div>
        </div>
      )}

      <section className="section">
        {items.length === 0 && preparing === 0 ? (
          // まだ撮っていない（カメラを閉じた・アプリのカメラが使えない）
          <>
            <div className="capture-buttons">
              <button type="button" className="btn capture" onClick={openCamera}>
                <VideoIcon size={28} />
                {t.record.shootVideo}
              </button>
              <button type="button" className="btn capture" onClick={() => photoInput.current?.click()}>
                <CameraIcon size={28} />
                {t.record.shootPhoto}
              </button>
              <button type="button" className="btn capture" onClick={() => libraryInput.current?.click()}>
                <PhotoIcon size={28} />
                {t.record.album}
              </button>
            </div>
            {next && !editing && (
              <p className="next-line">
                <span className="next-label">{t.record.thisTime}</span>
                <span className="next-text">{next.text}</span>
              </p>
            )}
          </>
        ) : (
          <ul className="previews">
            {items.map((item) => {
              const blob = itemBlob(item)
              const type = itemType(item)
              const poster = item.kind === 'new' ? item.poster?.blob : (item.replaced?.poster?.blob ?? item.media.poster)
              const privacyLabel = (item.kind === 'new' ? (item.privacy ?? videoSettings?.youtubePrivacy) : undefined) === 'public' ? t.common.anyone : t.common.linkOnly
              return (
                <li key={item.key}>
                  {blob ? (
                    <MediaView
                      blob={blob}
                      type={type}
                      poster={poster}
                      cacheKey={`${item.key}-${blob.size}`}
                      autoLoad={item.kind === 'new' || !!item.replaced}
                    />
                  ) : (
                    item.kind === 'existing' && <NotOnDevice media={item.media} />
                  )}
                  <button type="button" className="remove" aria-label={t.record.remove} onClick={() => removeItem(item)}>
                    ×
                  </button>
                  <div className="preview-actions">
                    {blob && <span className="muted">{formatBytes(blob.size)}</span>}
                    {blob && isVideo({ type }) && (
                      <button type="button" className="btn small" onClick={() => setTrimming(item.key)}>
                        <ScissorsIcon size={16} />
                        {t.common.edit}
                      </button>
                    )}
                    {/* 保存先が YouTube のとき、この動画の公開範囲（押すたびに切り替わる）。上げたあとの動画は変えられない */}
                    {storage === 'youtube' && item.kind === 'new' && isVideo({ type }) && (
                      <button
                        type="button"
                        className="btn small"
                        aria-label={t.record.privacyToggle(privacyLabel)}
                        onClick={() => togglePrivacy(item)}
                      >
                        {privacyLabel}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
            {/* 入れている途中の動画・写真の場所を先に空けておく（入ったときに、並びがずれないように） */}
            {Array.from({ length: preparing }, (_, i) => (
              <li key={`preparing-${i}`} aria-busy="true">
                <div className="media placeholder" />
              </li>
            ))}
            {/* 撮り足す（アプリのカメラ。アルバムもカメラの中から選べる） */}
            <li>
              <button type="button" className="media add-media" aria-label={t.record.addMore} onClick={openCamera}>
                <PlusIcon size={26} />
              </button>
            </li>
          </ul>
        )}
        {/* 仕上げる（つなぐ・BGM）。動画があるときに出す */}
        {joinable.length >= 1 && (
          <button type="button" className="btn small join-button" onClick={() => setJoining(true)}>
            <FilmIcon size={16} />
            {t.compose.join}
          </button>
        )}
        {[
          { ref: videoInput, accept: 'video/*', capture: true, multiple: false },
          { ref: photoInput, accept: 'image/*', capture: true, multiple: false },
          { ref: libraryInput, accept: 'image/*,video/*', capture: false, multiple: true },
        ].map((input) => (
          <input
            key={input.accept + String(input.capture)}
            ref={input.ref}
            hidden
            type="file"
            accept={input.accept}
            {...(input.capture ? { capture: 'environment' as const } : {})}
            multiple={input.multiple}
            onChange={(e) => {
              void run(() => addFiles(e.target.files))
              e.target.value = ''
            }}
          />
        ))}
        {editing && storage === 'youtube' && items.some((i) => i.kind === 'existing' && i.replaced && i.media.youtubeId) && (
          <p className="muted small">
            {t.record.reupload}
          </p>
        )}
      </section>

      <section className="section reflect">
        <div className="segmented outcome-picker" role="radiogroup" aria-label={t.outcome.label}>
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={outcome === o.value}
              className={outcome === o.value ? `selected outcome-${o.value}` : ''}
              onClick={() => {
                const nextOutcome = outcome === o.value ? undefined : o.value
                setOutcome(nextOutcome)
                // 原因は、うまくいかなかったときだけのもの。◎にしたら外す
                if (nextOutcome !== 'meh' && nextOutcome !== 'bad') setDraft((d) => ({ ...d, causes: undefined }))
                change()
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* うまくいかなかったときだけ、よくある原因をワンタップで選べる（書かなくて済むように） */}
        {causeOptions.length > 0 && (outcome === 'meh' || outcome === 'bad') && (
          <div className="cause-chips" role="group" aria-label={t.record.causes}>
            {causeOptions.map((c) => {
              const on = draft.causes?.includes(c) ?? false
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setDraft((d) => {
                      const prev = d.causes ?? []
                      return { ...d, causes: on ? prev.filter((x) => x !== c) : [...prev, c] }
                    })
                    change()
                  }}
                >
                  {c}
                </button>
              )
            })}
          </div>
        )}

        <div className="field">
          <label htmlFor="next-action">{t.record.nextAction}</label>
          {/* 押すだけで入る候補。前回と同じことを続けるときや、選んだ原因の直し方 */}
          {suggestions.length > 0 && (
            <div className="suggest-chips">
              {suggestions.map((sgt) => (
                <button
                  key={sgt.text}
                  type="button"
                  onClick={() => {
                    setDraft((d) => ({ ...d, nextAction: sgt.text }))
                    change()
                  }}
                >
                  <span className="suggest-prefix">{sgt.prefix}</span>
                  {sgt.text}
                </button>
              ))}
            </div>
          )}
          <textarea
            id="next-action"
            rows={2}
            value={draft.nextAction ?? ''}
            onChange={(e) => {
              setDraft((d) => ({ ...d, nextAction: e.target.value }))
              change()
            }}
            placeholder={t.record.nextActionPlaceholder}
          />
        </div>

        {showMemo ? (
          <label className="field">
            <span>{t.record.memo}</span>
            <textarea
              rows={2}
              autoFocus={memoOpen && !draft.reason}
              value={draft.reason ?? ''}
              onChange={(e) => {
                setDraft((d) => ({ ...d, reason: e.target.value }))
                change()
              }}
              placeholder={t.record.memoPlaceholder}
            />
          </label>
        ) : (
          <button type="button" className="quiet-button memo-toggle" onClick={() => setMemoOpen(true)}>
            {t.record.addMemo}
          </button>
        )}
      </section>

      {editing && (
        <section className="section danger-zone">
          <ConfirmButton
            className="btn ghost"
            confirmLabel={t.common.delete}
            message={t.record.deleteConfirm}
            onConfirm={async () => {
              const ok = await run(async () => {
                await deleteRecord(recordId)
                return true
              })
              if (ok) {
                toast.show(t.record.deleted)
                goBack(fallback)
              }
            }}
          >
            {t.record.deleteThis}
          </ConfirmButton>
        </section>
      )}

      {recording && videoSettings && (
        <Recorder
          quality={videoSettings.quality}
          focus={editing ? undefined : next?.text}
          references={skill.references}
          onDone={(video, photo, quality) => {
            setRecording(false)
            // できあがりの写真も撮ったら、動画と一緒に記録に入れる（カップの絵には写真を使う）
            const files = [video, photo].filter((f): f is File => !!f)
            void run(() => addFiles(files, true, quality))
          }}
          onClose={() => {
            setRecording(false)
            // 何も撮らず、何も付けずに閉じたら、記録をやめて戻る（結果や次の一手を付けていたら、この画面に残る）
            const blank =
              items.length === 0 && preparing === 0 && !outcome && !draft.reason && !draft.nextAction && !(draft.causes?.length ?? 0)
            if (!editing && blank) goBack(fallback)
          }}
          onAlbum={() => {
            setRecording(false)
            libraryInput.current?.click()
          }}
          onFallback={(mode) => {
            setRecording(false)
            ;(mode === 'photo' ? photoInput : videoInput).current?.click()
          }}
        />
      )}

      {pickingSkill && skills && (
        <SkillPicker skills={skills} current={skillId} onPick={pickSkill} onClose={() => setPickingSkill(false)} />
      )}

      {joining && (
        <Composer
          clips={joinable.map(
            (i): ComposerClip => ({
              key: i.key,
              blob: itemBlob(i)!,
              // 保存済みで、まだ切り取っていない動画は、アプリのファイルをそのまま書き出しに渡す
              file: i.kind === 'existing' && !i.replaced ? i.media.file : undefined,
            }),
          )}
          quality={(joinable[0]?.kind === 'new' ? joinable[0].quality : undefined) ?? videoSettings?.quality ?? 'standard'}
          fileName={joinable[0]?.kind === 'new' ? joinable[0].file.name : (joinable[0]?.media.name ?? 'video.mp4')}
          mayUsePaid={mayUsePaid}
          onDone={onJoined}
          onClose={() => setJoining(false)}
        />
      )}

      {trimItem && trimBlob && (
        <Trimmer
          file={trimBlob}
          name={trimItem.kind === 'new' ? trimItem.file.name : (trimItem.media.name ?? 'video.mp4')}
          onDone={(file) => onTrimmed(trimItem.key, file)}
          onClose={() => setTrimming(null)}
        />
      )}

      <div className="sticky-actions">
        {editing ? (
          <button className="btn primary block" disabled={saving || (!dirty && preparing === 0)} onClick={() => save()}>
            {saving ? t.common.saving : t.common.save}
          </button>
        ) : (
          // 続けて淹れるときは「もう1杯」（保存してすぐカメラへ）。終わるときは「保存」
          <div className="save-pair">
            <button className="btn" disabled={saving || nothingToSave} onClick={() => save(true)}>
              {t.record.saveAndMore}
            </button>
            <button className="btn primary" disabled={saving || nothingToSave} onClick={() => save()}>
              {saving ? t.common.saving : t.record.saveShort}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

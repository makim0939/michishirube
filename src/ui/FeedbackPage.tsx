import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_CONTACT_MAX, FEEDBACK_MESSAGE_MAX, type FeedbackKind } from '../../shared/feedback'
import { clearDraft, loadDraft, saveDraft, sendFeedback } from '../data/feedback'
import { useAction, useToast } from './feedback'
import { go } from './router'

const KINDS: { value: FeedbackKind; label: string; placeholder: string }[] = [
  { value: 'idea', label: '要望', placeholder: 'こんな機能がほしい、ここが使いにくい' },
  { value: 'bug', label: '不具合', placeholder: 'どの画面で、何をしたら、どうなりましたか' },
  { value: 'other', label: 'その他', placeholder: '何でもどうぞ' },
]

/**
 * ご意見・ご要望。ログインもメールアプリも要らず、書いて送るだけ（メールの設定がない端末でも送れる）。
 * 書きかけは端末に残し、送れなかったときも書き直さなくて済むようにする。
 * 返信がほしい人だけが連絡先を書く（折りたたんでおく）
 */
export function FeedbackPage() {
  const run = useAction()
  const toast = useToast()
  const [draft] = useState(() => loadDraft())
  const [kind, setKind] = useState<FeedbackKind>(draft?.kind ?? 'idea')
  const [message, setMessage] = useState(draft?.message ?? '')
  const [contact, setContact] = useState(draft?.contact ?? '')
  const [sending, setSending] = useState(false)
  const sent = useRef(false)

  useEffect(() => {
    // 送ったあとに、送った内容を書きかけとして残さない
    if (!sent.current) saveDraft({ kind, message, contact })
  }, [kind, message, contact])

  const submit = () =>
    run(async () => {
      setSending(true)
      try {
        await sendFeedback({ kind, message, contact })
        sent.current = true
        clearDraft()
        toast.show('届きました。ありがとうございます')
        go('/settings')
      } finally {
        setSending(false)
      }
    })

  return (
    <section className="section">
      <div className="stack">
        <div className="segmented feedback-kinds" role="radiogroup" aria-label="種類">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              className={kind === k.value ? 'selected' : ''}
              onClick={() => setKind(k.value)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <textarea
          rows={7}
          maxLength={FEEDBACK_MESSAGE_MAX}
          aria-label="内容"
          placeholder={KINDS.find((k) => k.value === kind)?.placeholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <details className="feedback-contact" open={contact !== ''}>
          <summary>返信がほしいとき</summary>
          <input
            type="text"
            inputMode="email"
            autoComplete="email"
            maxLength={FEEDBACK_CONTACT_MAX}
            aria-label="連絡先"
            placeholder="メールアドレスなど"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </details>
        <button className="btn primary" disabled={sending || !message.trim()} onClick={submit}>
          {sending ? '送っています…' : '送る'}
        </button>
        <p className="muted small">端末の種類とアプリのバージョンが、一緒に届きます。</p>
      </div>
    </section>
  )
}

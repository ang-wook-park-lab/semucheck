import { useState, type FormEvent } from 'react'
import { changePassword } from '../lib/admin'

/** 비밀번호 변경 양식(내 계정 화면과 첫 로그인 화면이 함께 쓴다) */
export default function PasswordForm({ currentLabel = '현재 비밀번호', submitLabel = '비밀번호 변경', onDone }: { currentLabel?: string; submitLabel?: string; onDone(): void }) {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (next !== again) return setMsg({ kind: 'error', text: '새 비밀번호 확인이 일치하지 않습니다.' })
    if (next === cur) return setMsg({ kind: 'error', text: '새 비밀번호는 현재(임시) 비밀번호와 달라야 합니다.' })
    setBusy(true)
    try {
      await changePassword(cur, next)
      setCur('')
      setNext('')
      setAgain('')
      setMsg({ kind: 'info', text: '비밀번호를 바꿨습니다. 다른 기기에서는 로그아웃됩니다.' })
      onDone()
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : '바꾸지 못했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel narrow" onSubmit={submit} data-testid="password-form">
      <label className="field">{currentLabel}<input type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></label>
      <label className="field">새 비밀번호 <small>(8자 이상)</small><input type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label className="field">새 비밀번호 확인<input type="password" autoComplete="new-password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} /></label>
      {msg && <p className={`msg ${msg.kind}`} role="alert">{msg.text}</p>}
      <button className="btn primary" disabled={busy}>{busy ? '변경 중…' : submitLabel}</button>
    </form>
  )
}

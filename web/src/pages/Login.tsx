import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { signIn, signUp, demo, mode, signupOpen } = useAuth()
  const canSignup = mode !== 'api' || signupOpen
  const [formMode, setFormMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (formMode === 'in') await signIn(email.trim(), password)
      else {
        const info = await signUp(email.trim(), password)
        if (info) {
          setMsg({ kind: 'info', text: info })
          setFormMode('in')
        }
      }
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : '처리하지 못했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-side">
        <h1>세무체크</h1>
        <p>정책자금·회계·노무 체크리스트를 체크하면 분야별 진단보고서가 만들어지는 컨설턴트용 진단 프로그램</p>
        <ul>
          <li>신호등(결격·감점·가점) 기준 진단</li>
          <li>수임 판단 · 보완 로드맵 · 추천 자금 매칭</li>
          <li>고객사별 진단 저장, 보고서 인쇄·PDF 저장</li>
        </ul>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>{formMode === 'in' ? '로그인' : '컨설턴트 계정 만들기'}</h2>
        {demo && (
          <div className="notice">
            <b>데모 모드</b> — 서버 DB(<code>DATABASE_URL</code>)나 Supabase가 연결되지 않아 계정과 진단이 <b>이 브라우저에만</b> 저장됩니다. 실제 운영 전 <code>docs/deploy.md</code>의 DB 연결을 하세요.
          </div>
        )}
        <label>
          이메일
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          비밀번호 {formMode === 'up' && <small>(8자 이상)</small>}
          <input type="password" autoComplete={formMode === 'in' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {msg && <p className={`msg ${msg.kind}`} role="alert">{msg.text}</p>}
        <button className="btn primary wide" disabled={busy}>{busy ? '처리 중…' : formMode === 'in' ? '로그인' : '가입하기'}</button>
        {(canSignup || formMode === 'up') && (
          <button type="button" className="link-btn" onClick={() => { setFormMode(formMode === 'in' ? 'up' : 'in'); setMsg(null) }}>
            {formMode === 'in' ? '계정이 없으신가요? 가입하기' : '이미 계정이 있습니다. 로그인'}
          </button>
        )}
        {mode === 'api' && !signupOpen && formMode === 'in' && <p className="muted small">새 계정은 관리자가 가입을 열어야 만들 수 있습니다.</p>}
      </form>
    </div>
  )
}

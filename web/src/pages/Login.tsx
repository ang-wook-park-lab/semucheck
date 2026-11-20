import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { signIn, signUp, demo, mode, canSignup, detection } = useAuth()
  const idLabel = mode === 'supabase' ? '이메일' : '아이디'
  const [formMode, setFormMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (formMode === 'in') await signIn(username.trim(), password)
      else {
        const info = await signUp(username.trim(), password, name)
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
        <h2>{formMode === 'in' ? '로그인' : '계정 만들기'}</h2>
        {demo && (
          <div className="notice">
            <b>데모 모드</b> — 서버 DB(<code>DATABASE_URL</code>)나 Supabase가 연결되지 않아 계정과 진단이 <b>이 브라우저에만</b> 저장됩니다. 실제 운영 전 <code>docs/deploy.md</code>의 DB 연결을 하세요.
            {detection?.kind === 'nodb' && <div className="small"><b>원인:</b> 서버는 응답했지만 DB가 연결되지 않았습니다. 서버의 <code>DATABASE_URL</code> 변수가 적용됐는지 확인하세요(변수 저장 후 재배포 필요).</div>}
            {detection?.kind === 'unavailable' && <div className="small"><b>원인:</b> 서버 상태를 확인하지 못했습니다(개발 서버이거나 네트워크 문제).</div>}
          </div>
        )}
        {formMode === 'up' && (
          <label>
            이름 <small>(화면 왼쪽 위에 표시됩니다)</small>
            <input type="text" autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 홍길동 컨설턴트" />
          </label>
        )}
        <label>
          {idLabel}
          <input
            type={mode === 'supabase' ? 'email' : 'text'}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          비밀번호 {formMode === 'up' && <small>(8자 이상)</small>}
          <input type="password" autoComplete={formMode === 'in' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {msg && <p className={`msg ${msg.kind}`} role="alert">{msg.text}</p>}
        <button className="btn primary wide" disabled={busy}>{busy ? '처리 중…' : formMode === 'in' ? '로그인' : '가입하기'}</button>
        {canSignup && (
          <button type="button" className="link-btn" onClick={() => { setFormMode(formMode === 'in' ? 'up' : 'in'); setMsg(null) }}>
            {formMode === 'in' ? '계정이 없으신가요? 가입하기' : '이미 계정이 있습니다. 로그인'}
          </button>
        )}
        {mode === 'api' && <p className="muted small">계정은 관리자가 만들어 줍니다. 아이디와 임시 비밀번호를 받았다면 로그인한 뒤 비밀번호를 바꾸세요.</p>}
      </form>
    </div>
  )
}

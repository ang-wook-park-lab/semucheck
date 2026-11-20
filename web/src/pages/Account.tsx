import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL } from '../lib/permissions'
import { LabelBox } from '../components/ui'
import PasswordForm from '../components/PasswordForm'

export default function Account() {
  const { user, mode } = useAuth()
  const [done, setDone] = useState(false)
  if (!user) return null
  return (
    <>
      <h1 className="page-title">내 계정</h1>
      <div className="stat-row">
        <LabelBox label="이름">{user.name}</LabelBox>
        <LabelBox label={mode === 'supabase' ? '이메일' : '아이디'}><span className="small">{user.username}</span></LabelBox>
        <LabelBox label="역할" tone="hot">{ROLE_LABEL[user.role]}</LabelBox>
      </div>
      {mode === 'api' ? (
        <>
          <h2 className="section-title">비밀번호 변경</h2>
          <PasswordForm onDone={() => setDone(true)} />
          {done && <p className="muted small">비밀번호를 바꿨습니다.</p>}
        </>
      ) : (
        <p className="muted">이 서버는 계정 관리 기능(서버 DB)이 연결되어 있지 않아 비밀번호 변경을 지원하지 않습니다.</p>
      )}
    </>
  )
}

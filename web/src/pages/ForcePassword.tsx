import { useAuth } from '../lib/auth'
import PasswordForm from '../components/PasswordForm'

/** 관리자가 만들어 준 임시 비밀번호로 처음 로그인했을 때, 본인 비밀번호를 정하기 전에는 다른 화면을 쓸 수 없다 */
export default function ForcePassword() {
  const { user, markPasswordChanged, signOut } = useAuth()
  if (!user) return null
  return (
    <div className="login-wrap">
      <div className="login-side">
        <h1>세무체크</h1>
        <p><b>{user.name}</b>님, 처음 오셨습니다.</p>
        <ul>
          <li>관리자가 정해 준 <b>임시 비밀번호</b>는 이번 한 번만 쓰는 비밀번호입니다.</li>
          <li>본인만 아는 새 비밀번호를 정하면 바로 시작할 수 있습니다.</li>
        </ul>
      </div>
      <div className="login-card" data-testid="force-password">
        <h2>비밀번호를 먼저 바꿔 주세요</h2>
        <p className="muted small">아이디 <code>{user.username}</code> — 받은 임시 비밀번호를 “임시 비밀번호” 칸에 입력하세요.</p>
        <PasswordForm currentLabel="임시 비밀번호" submitLabel="비밀번호 바꾸고 시작하기" onDone={markPasswordChanged} />
        <button type="button" className="link-btn" onClick={() => signOut()}>로그아웃</button>
      </div>
    </div>
  )
}

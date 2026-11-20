import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import {
  createSampleAccounts, createUser, deleteUser, getSampleStatus, listUsers, removeSample, seedSample, updateUser,
  type AppUser, type SampleAccounts, type SampleStatus,
} from '../lib/admin'
import { ROLE_LABEL } from '../lib/permissions'
import { useData } from '../lib/useData'
import type { Role } from '../lib/types'
import Modal from '../components/Modal'
import { fmtDate } from '../components/ui'

const ROLES: Role[] = ['admin', 'consultant', 'client']
const errText = (e: unknown) => (e instanceof Error ? e.message : '처리하지 못했습니다.')

export default function Users() {
  const { user: me, mode } = useAuth()
  const { clients, reload: reloadData } = useData()
  const [users, setUsers] = useState<AppUser[]>([])
  const [sample, setSample] = useState<SampleStatus | null>(null)
  const [accounts, setAccounts] = useState<SampleAccounts | null>(null)
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<AppUser | null>(null)

  const load = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([listUsers(), getSampleStatus()])
      setUsers(u)
      setSample(s)
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) })
    }
  }, [])
  useEffect(() => {
    if (mode === 'api') void load()
  }, [mode, load])

  if (mode !== 'api') return <p className="muted">사용자 관리는 서버 DB가 연결된 배포 환경에서만 사용할 수 있습니다.</p>

  async function run<T>(fn: () => Promise<T>, ok?: (r: T) => string) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fn()
      if (ok) setMsg({ kind: 'info', text: ok(r) })
      await load()
      await reloadData()
      return r
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="page-title">사용자 · 샘플 관리</h1>
      <p className="muted scope-note">관리자만 볼 수 있는 화면입니다. 계정을 만들고 역할을 정하면 역할에 따라 메뉴와 볼 수 있는 데이터가 달라집니다.</p>
      <div className="role-help panel">
        <div><span className="role-pill role-admin">관리자</span> 모든 고객사·진단 조회·수정, 사용자 관리, 체크리스트 수정</div>
        <div><span className="role-pill role-consultant">컨설턴트</span> 본인 담당 고객사·진단만 조회·수정, 체크리스트 조회</div>
        <div><span className="role-pill role-client">고객</span> 연결된 자기 회사의 완료된 보고서만 읽기 전용</div>
      </div>
      {msg && <p className={`msg ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}

      <h2 className="section-title">계정 만들기</h2>
      <CreateForm clients={clients.map((c) => ({ id: c.id, name: c.name }))} busy={busy} onCreate={(b) => run(() => createUser(b), () => '계정을 만들었습니다. 아이디와 임시 비밀번호를 본인에게 전달하세요. 첫 로그인 때 비밀번호를 바꾸도록 안내됩니다.')} />

      <h2 className="section-title">사용자 ({users.length})</h2>
      <div className="panel">
        <table className="table" data-testid="users-table">
          <thead>
            <tr><th>이름</th><th>아이디</th><th>역할</th><th>상태</th><th>담당 고객사 / 연결 고객사</th><th>생성일</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === me?.id
              return (
                <tr key={u.id} className={u.active ? '' : 'inactive'}>
                  <td>{u.name}{self && <span className="chip chip-blue">나</span>}{u.isSample && <span className="chip chip-gray">샘플</span>}</td>
                  <td><code>{u.username}</code></td>
                  <td><span className={`role-pill role-${u.role}`}>{ROLE_LABEL[u.role]}</span></td>
                  <td>{u.active ? '사용' : <span className="muted">비활성</span>}{u.mustChangePassword && <span className="chip chip-gray" title="임시 비밀번호를 아직 바꾸지 않았습니다">임시 비밀번호</span>}</td>
                  <td>{u.role === 'client' ? u.clientName || '(연결 없음)' : `${u.clientCount}곳`}</td>
                  <td>{fmtDate(u.createdAt)}</td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => setEditing(u)}>수정</button>
                    <button className="btn small ghost" disabled={self || busy} title={self ? '자신의 상태는 바꿀 수 없습니다' : ''} onClick={() => run(() => updateUser(u.id, { active: !u.active }), () => (u.active ? '비활성화했습니다. 이 사용자는 로그인할 수 없습니다.' : '다시 활성화했습니다.'))}>
                      {u.active ? '비활성화' : '활성화'}
                    </button>
                    <button
                      className="btn small ghost"
                      disabled={self || busy}
                      onClick={() => {
                        if (window.confirm(`"${u.name}" 계정을 삭제합니다. 되돌릴 수 없습니다.`)) void run(() => deleteUser(u.id), () => '삭제했습니다.')
                      }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="muted small">담당 고객사가 있는 컨설턴트는 삭제할 수 없습니다. 비활성화하거나 고객사 화면에서 담당자를 다른 컨설턴트로 바꾸세요.</p>
      </div>

      <h2 className="section-title">샘플 데이터</h2>
      <div className="panel" data-testid="sample-panel">
        <p>
          가상의 샘플 고객사 3곳과 진단 9건(정밀·간단 진단, 4개 분야)이 화면 확인용으로 들어 있습니다. 실제 고객사 정보가 아닙니다.
          {sample && <> 현재 <b>고객사 {sample.clientCount}곳, 진단 {sample.diagnosisCount}건</b>{sample.accounts.length > 0 && <>, 샘플 계정 {sample.accounts.length}개</>}.</>}
        </p>
        <div className="btn-row">
          <button className="btn" disabled={busy || (sample?.clientCount ?? 0) > 0} onClick={() => run(seedSample, (r) => `샘플 고객사 ${r.clients}곳, 진단 ${r.diagnoses}건을 넣었습니다.`)}>샘플 데이터 넣기</button>
          <button
            className="btn"
            disabled={busy || (sample?.clientCount ?? 0) === 0}
            onClick={async () => {
              const r = await run(createSampleAccounts)
              if (r) setAccounts(r)
            }}
          >
            샘플 계정 만들기 (컨설턴트·고객)
          </button>
          <button
            className="btn ghost"
            disabled={busy || ((sample?.clientCount ?? 0) === 0 && (sample?.accounts.length ?? 0) === 0)}
            onClick={() => {
              if (window.confirm('샘플 고객사·진단·샘플 계정을 모두 지웁니다. 실제 데이터는 지워지지 않습니다.')) void run(removeSample, (r) => `샘플 고객사 ${r.clientsRemoved}곳과 계정 ${r.accountsRemoved}개를 지웠습니다.`)
            }}
          >
            샘플 모두 지우기
          </button>
        </div>
        <p className="muted small">샘플 컨설턴트는 [샘플] 새봄푸드만, 샘플 고객은 [샘플] (주)한빛정밀의 완료된 보고서만 볼 수 있어 권한 차이를 확인할 수 있습니다. 샘플 계정의 비밀번호는 만들 때 무작위로 정해지고 <b>한 번만</b> 표시됩니다.</p>
        {accounts && (
          <div className="secret-box" role="status" data-testid="sample-accounts">
            <b>샘플 계정이 만들어졌습니다. 이 비밀번호는 지금만 볼 수 있습니다.</b>
            {accounts.created.length === 0 && <p>새로 만든 계정이 없습니다(이미 있음: {accounts.skipped.join(', ')}).</p>}
            <ul>
              {accounts.created.map((a) => (
                <li key={a.username}>
                  <span className={`role-pill role-${a.role}`}>{ROLE_LABEL[a.role]}</span> {a.name} — 아이디 <code>{a.username}</code> / 비밀번호 <code>{a.password}</code>
                </li>
              ))}
            </ul>
            <button className="btn small" onClick={() => setAccounts(null)}>확인했습니다(닫기)</button>
          </div>
        )}
      </div>

      {editing && (
        <EditUser
          user={editing}
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          busy={busy}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const r = await run(() => updateUser(editing.id, patch), () => '저장했습니다.')
            if (r) setEditing(null)
          }}
        />
      )}
    </>
  )
}

function CreateForm({ clients, busy, onCreate }: { clients: { id: string; name: string }[]; busy: boolean; onCreate(b: { username: string; name: string; role: Role; password: string; clientId?: string }): Promise<unknown> }) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('consultant')
  const [clientId, setClientId] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = await onCreate({ name, username, password, role, ...(role === 'client' ? { clientId } : {}) })
    if (r) {
      setName('')
      setUsername('')
      setPassword('')
      setClientId('')
    }
  }
  return (
    <form className="panel form-grid" onSubmit={submit} aria-label="계정 만들기">
      <label className="field">이름<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 김컨설턴트" /></label>
      <label className="field">아이디 <small>(영문 소문자·숫자·. _ - , 3~30자)</small><input type="text" required minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9._\-]{2,29}" title="영문 소문자·숫자·마침표·밑줄·하이픈으로 3~30자" autoComplete="off" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="예: kim.consultant" /></label>
      <label className="field">임시 비밀번호 <small>(8자 이상 · 본인이 첫 로그인 때 바꿉니다)</small><input type="text" required minLength={8} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <label className="field">
        역할
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="역할">
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      {role === 'client' && (
        <label className="field full">
          연결할 고객사 <small>(이 고객은 이 회사의 완료된 보고서만 볼 수 있습니다)</small>
          <select required value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="연결할 고객사">
            <option value="">고객사를 선택하세요</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <button className="btn primary" disabled={busy}>계정 만들기</button>
    </form>
  )
}

function EditUser({ user, clients, busy, isSelf, onClose, onSave }: { user: AppUser; clients: { id: string; name: string }[]; busy: boolean; isSelf: boolean; onClose(): void; onSave(p: { name?: string; role?: Role; clientId?: string | null; password?: string }): Promise<void> }) {
  const [name, setName] = useState(user.name)
  const [role, setRole] = useState<Role>(user.role)
  const [clientId, setClientId] = useState(user.clientId ?? '')
  const [password, setPassword] = useState('')
  return (
    <Modal title={`사용자 수정 — ${user.username}`} onClose={onClose}>
      <div className="form-stack">
        <label className="field">이름<input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">
          역할
          <select value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)} aria-label="역할 변경">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          {isSelf && <small>자신의 역할은 바꿀 수 없습니다.</small>}
        </label>
        {role === 'client' && (
          <label className="field">
            연결 고객사
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="연결 고객사">
              <option value="">선택하세요</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className="field">새 비밀번호 <small>(다시 정해 줄 때만 입력 · 8자 이상 · 임시 비밀번호가 되어 다음 로그인 때 본인이 바꿔야 하고, 지금 로그인된 곳은 모두 해제됩니다)</small><input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>취소</button>
        <button
          className="btn primary"
          disabled={busy || (role === 'client' && !clientId)}
          onClick={() => void onSave({ name, ...(isSelf ? {} : { role }), clientId: role === 'client' ? clientId : null, ...(password ? { password } : {}) })}
        >
          저장
        </button>
      </div>
    </Modal>
  )
}

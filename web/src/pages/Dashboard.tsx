import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { domains } from '../lib/checklists'
import { can, ROLE_LABEL } from '../lib/permissions'
import { useData } from '../lib/useData'
import DiagnosisTable from '../components/DiagnosisTable'
import { Icon, LabelBox } from '../components/ui'
import MobileHome from '../components/MobileHome'
import { usePhone } from '../lib/viewMode'
import { domainClass, domainIcon } from '../lib/domainColor'

export default function Dashboard() {
  const { user } = useAuth()
  const { clients, diagnoses, loading, error } = useData()
  const role = user?.role
  const done = diagnoses.filter((d) => d.status === 'completed').length
  const phone = usePhone()

  // 고객: 자기 회사의 완료된 진단 보고서만 읽기 전용으로 본다
  if (!can(role, 'editData')) {
    return (
      <>
        <h1 className="page-title">내 진단 보고서</h1>
        {error && <p className="msg error">{error}</p>}
        <p className="muted">{clients[0] ? <><b>{clients[0].name}</b>의 </> : ''}담당 컨설턴트가 완료한 진단 보고서입니다. 보고서는 읽기 전용이며 엑셀로 내려받을 수 있습니다.</p>
        <div className="panel">{loading ? <p className="empty">불러오는 중…</p> : <DiagnosisTable diagnoses={diagnoses} clients={clients} />}</div>
      </>
    )
  }

  // 휴대폰: 상담 중에 누르기 쉬운 큰 버튼 홈
  if (phone) return <MobileHome />

  return (
    <>
      <h1 className="page-title">홈</h1>
      {error && <p className="msg error">{error}</p>}
      <p className="muted scope-note">
        {role === 'admin' ? <>관리자 권한: <b>모든 컨설턴트</b>의 고객사·진단이 표시됩니다.</> : <>{role ? ROLE_LABEL[role] : ''} 권한: <b>내 담당 고객사</b>와 그 진단만 표시됩니다.</>}
      </p>
      <div className="stat-row">
        <LabelBox label={role === 'admin' ? '전체 고객사' : '내 담당 고객사'}>{loading ? '–' : clients.length}</LabelBox>
        <LabelBox label="진행 중 진단" tone="hot">{loading ? '–' : diagnoses.length - done}</LabelBox>
        <LabelBox label="완료한 진단">{loading ? '–' : done}</LabelBox>
      </div>
      <h2 className="section-title">분야별 진단 시작</h2>
      <div className="domain-cards">
        {domains.map((d) => (
          <div key={d.key} className={`domain-card ${domainClass(d.key)} ${d.ready ? '' : 'disabled'}`}>
            <div className="dc-head"><Icon name={domainIcon(d.key)} size={20} /> {d.label}</div>
            <p>{d.description}</p>
            {d.ready ? (
              <div className="dc-actions">
                <Link className="btn small btn-full" to={`/start/${d.key}`}>정밀 진단 · {d.count}{d.kind === 'status' ? '항목' : '문항'}</Link>
                {d.quickCount > 0 && <Link className="btn small btn-quick" to={`/start/${d.key}?mode=quick`}>간단 진단 · {d.quickCount}</Link>}
              </div>
            ) : (
              <div className="dc-foot">{d.count ? `샘플 ${d.count}문항 · 준비 중` : '체크리스트 준비 중'}</div>
            )}
          </div>
        ))}
      </div>
      <h2 className="section-title">최근 진단</h2>
      <div className="panel">
        <DiagnosisTable diagnoses={diagnoses.slice(0, 5)} clients={clients} />
      </div>
    </>
  )
}

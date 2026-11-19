import { Link } from 'react-router-dom'
import { domains } from '../lib/checklists'
import { useData } from '../lib/useData'
import DiagnosisTable from '../components/DiagnosisTable'
import { LabelBox } from '../components/ui'

export default function Dashboard() {
  const { clients, diagnoses, loading, error } = useData()
  const done = diagnoses.filter((d) => d.status === 'completed').length
  return (
    <>
      <h1 className="page-title">홈</h1>
      {error && <p className="msg error">{error}</p>}
      <div className="stat-row">
        <LabelBox label="고객사">{loading ? '–' : clients.length}</LabelBox>
        <LabelBox label="진행 중 진단" tone="hot">{loading ? '–' : diagnoses.length - done}</LabelBox>
        <LabelBox label="완료한 진단">{loading ? '–' : done}</LabelBox>
      </div>
      <h2 className="section-title">분야별 진단 시작</h2>
      <div className="domain-cards">
        {domains.map((d) => (
          <Link key={d.key} to={`/start/${d.key}`} className={`domain-card ${d.ready ? '' : 'disabled'}`}>
            <div className="dc-head">{d.label}</div>
            <p>{d.description}</p>
            <div className="dc-foot">{d.ready ? `${d.items.length}문항` : d.items.length ? `샘플 ${d.items.length}문항 · 준비 중` : '체크리스트 준비 중'}</div>
          </Link>
        ))}
      </div>
      <h2 className="section-title">최근 진단</h2>
      <div className="panel">
        <DiagnosisTable diagnoses={diagnoses.slice(0, 5)} clients={clients} />
      </div>
    </>
  )
}

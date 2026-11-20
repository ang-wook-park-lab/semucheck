import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { listUsers, type AppUser } from '../lib/admin'
import { domains } from '../lib/checklists'
import { useData } from '../lib/useData'
import DiagnosisTable from '../components/DiagnosisTable'
import { LabelBox } from '../components/ui'

export default function ClientDetail() {
  const { id } = useParams()
  const { clients, diagnoses, loading, store, reload } = useData()
  const { user, mode } = useAuth()
  const nav = useNavigate()
  const canReassign = user?.role === 'admin' && mode === 'api'
  const [owners, setOwners] = useState<AppUser[]>([])
  useEffect(() => {
    if (canReassign) listUsers().then((u) => setOwners(u.filter((x) => x.active && (x.role === 'admin' || x.role === 'consultant')))).catch(() => setOwners([]))
  }, [canReassign])
  if (loading) return <p className="empty">불러오는 중…</p>
  const client = clients.find((c) => c.id === id)
  if (!client) return <Navigate to="/clients" replace />
  const p = client.profile
  const mine = diagnoses.filter((d) => d.clientId === client.id)
  return (
    <>
      <div className="title-row">
        <h1 className="page-title">{client.name}</h1>
        <button
          className="btn ghost"
          onClick={async () => {
            if (!window.confirm(`"${client.name}"과(와) 이 고객사의 진단 ${mine.length}건을 모두 삭제합니다. 되돌릴 수 없습니다.`)) return
            await store?.deleteClient(client.id)
            nav('/clients')
          }}
        >
          고객사 삭제
        </button>
      </div>
      <div className="stat-row">
        <LabelBox label="업종">{p.industry}</LabelBox>
        <LabelBox label="사업자 형태">{p.business_type}</LabelBox>
        <LabelBox label="업력">{p.business_age}년</LabelBox>
        <LabelBox label="상시근로자">{p.employees}명</LabelBox>
        <LabelBox label="장부">{p.bookkeeping}</LabelBox>
      </div>
      {canReassign && (
        <p className="owner-row">
          <label>
            담당 컨설턴트{' '}
            <select
              value={client.ownerId ?? ''}
              aria-label="담당 컨설턴트"
              onChange={async (e) => {
                await store?.saveClient({ ...client, ownerId: e.target.value })
                await reload()
              }}
            >
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.name} ({o.username})</option>
              ))}
            </select>
          </label>
          <span className="muted small"> 바꾸면 이 고객사의 진단도 함께 새 담당자에게 넘어갑니다.</span>
        </p>
      )}
      {!canReassign && client.ownerName && <p className="muted small">담당 컨설턴트: {client.ownerName}</p>}
      <p className="tags">
        {p.has_research_lab && <span className="chip chip-blue">연구소·전담부서</span>}
        {p.has_venture && <span className="chip chip-blue">벤처 확인</span>}
        {p.planning_job_invention && <span className="chip chip-blue">직무발명보상 도입 계획</span>}
      </p>
      <h2 className="section-title">새 진단</h2>
      <div className="btn-row">
        {domains.filter((d) => d.ready).map((d) => (
          <Link key={d.key} className="btn" to={`/start/${d.key}`}>{d.label} 진단</Link>
        ))}
      </div>
      <h2 className="section-title">진단 내역</h2>
      <div className="panel">
        <DiagnosisTable
          diagnoses={mine}
          clients={clients}
          onDelete={async (d) => {
            if (!window.confirm('이 진단을 삭제합니다. 되돌릴 수 없습니다.')) return
            await store?.deleteDiagnosis(d.id)
            await reload()
          }}
        />
      </div>
    </>
  )
}

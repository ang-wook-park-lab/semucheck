import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { getDomain } from '../lib/checklists'
import { newId } from '../lib/store'
import { useData } from '../lib/useData'
import type { Answer, Client, Diagnosis } from '../lib/types'
import ClientForm from '../components/ClientForm'

export default function Start() {
  const { domain: key } = useParams()
  const domain = key ? getDomain(key) : undefined
  const { clients, loading, store } = useData()
  const nav = useNavigate()
  const [clientId, setClientId] = useState('')
  const [err, setErr] = useState<string | null>(null)
  if (!domain) return <Navigate to="/" replace />

  async function begin(client: Client, isNew: boolean) {
    if (!store || !domain) return
    try {
      if (isNew) await store.saveClient(client)
      const now = new Date().toISOString()
      const answers: Record<string, Answer> = {}
      // 고객사 정보에서 이미 아는 값은 미리 채운다(정책자금: 업력·상시근로자)
      if (domain.key === 'policy-fund') {
        answers['FUND-011'] = client.profile.business_age
        answers['FUND-014'] = client.profile.employees
      }
      const d: Diagnosis = { id: newId(), clientId: client.id, domain: domain.key, answers, notes: {}, status: 'in_progress', createdAt: now, updatedAt: now }
      await store.saveDiagnosis(d)
      nav(`/diagnosis/${d.id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '진단을 시작하지 못했습니다.')
    }
  }

  return (
    <>
      <h1 className="page-title">{domain.label} 진단 시작</h1>
      {!domain.ready && (
        <div className="notice">
          {domain.label} 체크리스트는 아직 준비 중입니다({domain.items.length}문항). 책에서 진단 기준을 정리하는 대로 추가됩니다. 지금은 정책자금 진단을 사용하세요.
        </div>
      )}
      {err && <p className="msg error">{err}</p>}
      {domain.ready && (
        <div className="two-col">
          <section>
            <h2 className="section-title">기존 고객사로 시작</h2>
            <div className="panel">
              {loading ? (
                <p className="empty">불러오는 중…</p>
              ) : clients.length === 0 ? (
                <p className="empty">등록된 고객사가 없습니다. 오른쪽에서 새로 등록하세요.</p>
              ) : (
                <>
                  <select className="wide-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="">고객사를 선택하세요</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button className="btn primary wide" disabled={!clientId} onClick={() => { const c = clients.find((x) => x.id === clientId); if (c) void begin(c, false) }}>
                    진단 시작
                  </button>
                </>
              )}
            </div>
          </section>
          <section>
            <h2 className="section-title">새 고객사 등록 후 시작</h2>
            <ClientForm submitLabel="저장하고 진단 시작" onSubmit={(c) => begin(c, true)} />
          </section>
        </div>
      )}
    </>
  )
}

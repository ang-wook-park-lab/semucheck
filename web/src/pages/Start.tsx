import { useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getDomain, modeCount } from '../lib/checklists'
import { useAuth } from '../lib/auth'
import { newId } from '../lib/store'
import { useData } from '../lib/useData'
import type { Answer, Client, Diagnosis, DiagnosisMode } from '../lib/types'
import ClientForm from '../components/ClientForm'

export default function Start() {
  const { domain: key } = useParams()
  const [search, setSearch] = useSearchParams()
  const domain = key ? getDomain(key) : undefined
  const { clients, loading, store } = useData()
  const { user } = useAuth()
  const nav = useNavigate()
  const [clientId, setClientId] = useState('')
  const [err, setErr] = useState<string | null>(null)
  if (!domain) return <Navigate to="/" replace />

  const mode: DiagnosisMode = search.get('mode') === 'quick' && domain.quickCount > 0 ? 'quick' : 'full'
  const setMode = (m: DiagnosisMode) => setSearch(m === 'quick' ? { mode: 'quick' } : {}, { replace: true })

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
      const d: Diagnosis = { id: newId(), clientId: client.id, domain: domain.key, answers, notes: {}, status: 'in_progress', mode, createdAt: now, updatedAt: now }
      await store.saveDiagnosis(d)
      nav(`/diagnosis/${d.id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '진단을 시작하지 못했습니다.')
    }
  }

  return (
    <>
      <h1 className="page-title">{domain.label} {mode === 'quick' ? '간단 진단' : '정밀 진단'} 시작</h1>
      {!domain.ready && (
        <div className="notice">
          {domain.label} 체크리스트는 아직 준비 중입니다({domain.count}문항). 책에서 진단 기준을 정리하는 대로 추가됩니다.
        </div>
      )}
      {err && <p className="msg error">{err}</p>}
      {domain.ready && (
        <>
          <div className="mode-pick" role="radiogroup" aria-label="진단 방식">
            <button type="button" role="radio" aria-checked={mode === 'full'} className={`mode-card m-full ${mode === 'full' ? 'on' : ''}`} onClick={() => setMode('full')}>
              <b>정밀 진단</b>
              <span>{modeCount(domain, 'full')}문항 · 빠짐없이 점검</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'quick'}
              disabled={domain.quickCount === 0}
              className={`mode-card m-quick ${mode === 'quick' ? 'on' : ''}`}
              onClick={() => setMode('quick')}
            >
              <b>간단 진단</b>
              <span>{modeCount(domain, 'quick')}문항 · 핵심 위험 위주로 빠르게</span>
            </button>
          </div>
          <div className="two-col">
            <section>
              <h2 className="section-title">기존 고객사로 시작</h2>
              <div className="panel">
                {loading ? (
                  <p className="empty">불러오는 중…</p>
                ) : clients.length === 0 ? (
                  <p className="empty">{user?.role === 'consultant' ? '내 담당 고객사가 없습니다. 오른쪽에서 새로 등록하세요.' : '등록된 고객사가 없습니다. 오른쪽에서 새로 등록하세요.'}</p>
                ) : (
                  <>
                    <select className="wide-select" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="고객사 선택">
                      <option value="">고객사를 선택하세요</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{user?.role === 'admin' && c.ownerName ? ` (담당: ${c.ownerName})` : ''}</option>
                      ))}
                    </select>
                    <button className="btn primary wide" disabled={!clientId} onClick={() => { const c = clients.find((x) => x.id === clientId); if (c) void begin(c, false) }}>
                      {mode === 'quick' ? '간단 진단 시작' : '정밀 진단 시작'}
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
        </>
      )}
    </>
  )
}

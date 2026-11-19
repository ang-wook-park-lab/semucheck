import { useState } from 'react'
import type { Client, ClientProfile } from '../lib/types'
import { newId } from '../lib/store'
import { LabelBox } from './ui'

const INDUSTRIES = ['제조업(C)', '정보통신업(J)', '전문·과학·기술서비스(M)', '보건·사회복지(Q)', '교육서비스(P)', '도소매업(G)', '건설업(F)', '숙박·음식점업(I)', '부동산업(L)', '기타']

export const EMPTY_PROFILE: ClientProfile = {
  business_type: '법인',
  business_age: 3,
  employees: 5,
  bookkeeping: '복식부기',
  has_research_lab: false,
  has_venture: false,
  planning_job_invention: false,
  industry: '제조업(C)',
}

export default function ClientForm({ onSubmit, submitLabel = '고객사 저장' }: { onSubmit: (c: Client) => void | Promise<void>; submitLabel?: string }) {
  const [name, setName] = useState('')
  const [p, setP] = useState<ClientProfile>(EMPTY_PROFILE)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof ClientProfile>(k: K, v: ClientProfile[K]) => setP((s) => ({ ...s, [k]: v }))
  const num = (v: string) => Math.max(0, Number(v) || 0)

  return (
    <form
      className="panel form-grid"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        setBusy(true)
        try {
          await onSubmit({ id: newId(), name: name.trim(), profile: p, createdAt: new Date().toISOString() })
        } finally {
          setBusy(false)
        }
      }}
    >
      <LabelBox label="고객사명">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: (주)OO정밀" required />
      </LabelBox>
      <LabelBox label="업종 대분류">
        <select value={p.industry} onChange={(e) => set('industry', e.target.value)}>
          {INDUSTRIES.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
      </LabelBox>
      <LabelBox label="사업자 형태">
        <select value={p.business_type} onChange={(e) => set('business_type', e.target.value as ClientProfile['business_type'])}>
          <option>법인</option>
          <option>개인</option>
        </select>
      </LabelBox>
      <LabelBox label="업력(년)">
        <input type="number" min={0} value={p.business_age} onChange={(e) => set('business_age', num(e.target.value))} />
      </LabelBox>
      <LabelBox label="상시근로자(명)">
        <input type="number" min={0} value={p.employees} onChange={(e) => set('employees', num(e.target.value))} />
      </LabelBox>
      <LabelBox label="장부 방식">
        <select value={p.bookkeeping} onChange={(e) => set('bookkeeping', e.target.value as ClientProfile['bookkeeping'])}>
          <option>복식부기</option>
          <option>간편장부</option>
        </select>
      </LabelBox>
      <div className="checks">
        <label><input type="checkbox" checked={p.has_research_lab} onChange={(e) => set('has_research_lab', e.target.checked)} /> 기업부설연구소·전담부서 보유</label>
        <label><input type="checkbox" checked={p.has_venture} onChange={(e) => set('has_venture', e.target.checked)} /> 벤처기업 확인 보유</label>
        <label><input type="checkbox" checked={p.planning_job_invention} onChange={(e) => set('planning_job_invention', e.target.checked)} /> 직무발명보상 도입 계획</label>
      </div>
      <button className="btn primary" disabled={busy}>{submitLabel}</button>
    </form>
  )
}

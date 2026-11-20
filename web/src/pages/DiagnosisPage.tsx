import { Navigate, useParams } from 'react-router-dom'
import { getDomain } from '../lib/checklists'
import { useDiagnosisEditor, type ReadyEditor } from '../lib/useDiagnosisEditor'
import RiskDiagnosis from '../components/RiskDiagnosis'
import GeneralCheck from '../components/GeneralCheck'

export default function DiagnosisPage() {
  const { id } = useParams()
  const e = useDiagnosisEditor(id)
  if (e.loading) return <p className="empty">불러오는 중…</p>
  if (!e.diag) return e.exists ? null : <Navigate to="/diagnoses" replace />
  const domain = getDomain(e.diag.domain)
  if (!e.client || !domain) return <Navigate to="/diagnoses" replace />
  const ed: ReadyEditor = { ...e, diag: e.diag, client: e.client }
  if (domain.kind === 'status' && domain.status) return <GeneralCheck ed={ed} checklist={domain.status} />
  return <RiskDiagnosis ed={ed} domain={domain} />
}

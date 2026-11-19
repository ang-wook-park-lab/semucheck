import { useData } from '../lib/useData'
import DiagnosisTable from '../components/DiagnosisTable'

export default function Diagnoses() {
  const { clients, diagnoses, store, reload, error } = useData()
  return (
    <>
      <h1 className="page-title">진단 내역 · 보고서</h1>
      {error && <p className="msg error">{error}</p>}
      <div className="panel">
        <DiagnosisTable
          diagnoses={diagnoses}
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

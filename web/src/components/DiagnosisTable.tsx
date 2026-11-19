import { Link } from 'react-router-dom'
import type { Client, Diagnosis } from '../lib/types'
import { getDomain } from '../lib/checklists'
import { buildReport } from '../lib/report'
import { fmtDate, Progress } from './ui'

export default function DiagnosisTable({ diagnoses, clients, onDelete }: { diagnoses: Diagnosis[]; clients: Client[]; onDelete?: (d: Diagnosis) => void }) {
  if (!diagnoses.length) return <p className="empty">아직 진단이 없습니다. 왼쪽 메뉴의 "진단 시작"에서 시작하세요.</p>
  return (
    <table className="table">
      <thead>
        <tr>
          <th>고객사</th>
          <th>분야</th>
          <th>진행률</th>
          <th>결과</th>
          <th>수정일</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {diagnoses.map((d) => {
          const client = clients.find((c) => c.id === d.clientId)
          const dom = getDomain(d.domain)
          let pct = 0
          let reds = 0
          let yellows = 0
          if (client && dom) {
            const r = buildReport(dom.items, d, client)
            pct = r.applicable.length ? (r.answeredCount / r.applicable.length) * 100 : 0
            reds = r.reds.length
            yellows = r.yellows.length
          }
          return (
            <tr key={d.id}>
              <td>
                <Link to={`/clients/${d.clientId}`}>{client?.name ?? '(삭제된 고객사)'}</Link>
              </td>
              <td>{dom?.label ?? d.domain}</td>
              <td className="progress-cell">
                <Progress value={pct} />
                <span>{Math.round(pct)}%{d.status === 'completed' ? ' · 완료' : ''}</span>
              </td>
              <td>
                <span className="chip chip-red">{reds}</span> <span className="chip chip-yellow">{yellows}</span>
              </td>
              <td>{fmtDate(d.updatedAt)}</td>
              <td className="row-actions">
                <Link className="btn small" to={`/diagnosis/${d.id}`}>{d.status === 'completed' ? '수정' : '이어하기'}</Link>
                <Link className="btn small primary" to={`/report/${d.id}`}>보고서</Link>
                {onDelete && (
                  <button className="btn small ghost" onClick={() => onDelete(d)}>삭제</button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

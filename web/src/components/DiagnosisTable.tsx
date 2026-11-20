import { Link } from 'react-router-dom'
import type { Client, Diagnosis } from '../lib/types'
import { useAuth } from '../lib/auth'
import { getDomain, itemsForMode, statusForMode } from '../lib/checklists'
import { can } from '../lib/permissions'
import { buildReport } from '../lib/report'
import { buildGeneralReport } from '../lib/general'
import { fmtDate, Progress } from './ui'

export default function DiagnosisTable({ diagnoses, clients, onDelete }: { diagnoses: Diagnosis[]; clients: Client[]; onDelete?: (d: Diagnosis) => void }) {
  const { user } = useAuth()
  const canEdit = can(user?.role, 'editData')
  const showOwner = user?.role === 'admin'
  if (!diagnoses.length) return <p className="empty">{canEdit ? '아직 진단이 없습니다. 왼쪽 메뉴의 "진단"에서 시작하세요.' : '아직 완료된 진단 보고서가 없습니다.'}</p>
  return (
    <table className="table">
      <thead>
        <tr>
          <th>고객사</th>
          {showOwner && <th>담당</th>}
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
          if (client && dom?.kind === 'status' && dom.status) {
            const r = buildGeneralReport(statusForMode(dom.status, d.mode), d, client)
            pct = r.totalCount ? (r.answeredCount / r.totalCount) * 100 : 0
            reds = r.totals.bad
            yellows = r.totals.fix
          } else if (client && dom) {
            const r = buildReport(itemsForMode(dom, d.mode), d, client)
            pct = r.applicable.length ? (r.answeredCount / r.applicable.length) * 100 : 0
            reds = r.reds.length
            yellows = r.yellows.length
          }
          return (
            <tr key={d.id}>
              <td>{canEdit ? <Link to={`/clients/${d.clientId}`}>{client?.name ?? '(삭제된 고객사)'}</Link> : (client?.name ?? '')}{client?.isSample && <span className="chip chip-gray" title="가상의 샘플 데이터">샘플</span>}</td>
              {showOwner && <td>{client?.ownerName ?? ''}</td>}
              <td>
                {dom?.label ?? d.domain}
                <span className={`chip ${d.mode === 'quick' ? 'chip-quick' : 'chip-full'}`} title={d.mode === 'quick' ? '문항을 줄인 간단 진단' : '모든 문항을 점검한 정밀 진단'}>{d.mode === 'quick' ? '간단' : '정밀'}</span>
              </td>
              <td className="progress-cell">
                <Progress value={pct} />
                <span>{Math.round(pct)}%{d.status === 'completed' ? ' · 완료' : ''}</span>
              </td>
              <td>
                <span className="chip chip-red">{reds}</span> <span className="chip chip-yellow">{yellows}</span>
              </td>
              <td>{fmtDate(d.updatedAt)}</td>
              <td className="row-actions">
                {canEdit && <Link className="btn small" to={`/diagnosis/${d.id}`}>{d.status === 'completed' ? '수정' : '이어하기'}</Link>}
                <Link className="btn small primary" to={`/report/${d.id}`}>보고서</Link>
                {canEdit && onDelete && <button className="btn small ghost" onClick={() => onDelete(d)}>삭제</button>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { buildGeneralReport, STATUS_LABEL, STATUS_MARK, type GmFinding } from '../lib/general'
import type { Client, Diagnosis, GmChecklist } from '../lib/types'
import { fmtDate, Icon, LabelBox } from './ui'

const TONE = { blocked: 'red', hold: 'red', urgent: 'red', prepare: 'yellow', fix: 'yellow', incomplete: 'gray', immediate: 'blue', good: 'blue' } as const

function Finding({ f }: { f: GmFinding }) {
  return (
    <article className={`finding ${f.status === 'bad' ? 'f-red' : 'f-yellow'}`}>
      <header>
        <span className="qid">{f.item.id}</span>
        <span className={`chip ${f.status === 'bad' ? 'chip-red' : 'chip-yellow'}`}>{STATUS_MARK[f.status]} {STATUS_LABEL[f.status]}</span>
        <span className="weight">위험도 {f.item.risk_level === 'high' ? '높음' : f.item.risk_level === 'medium' ? '보통' : '낮음'}</span>
      </header>
      <h4>{f.item.text}</h4>
      <p className="muted small">{f.area.name}</p>
      <p className="rec"><b>개선 권고</b> {f.item.recommendation}</p>
      {f.item.legal_basis && <p className="small muted">근거: {f.item.legal_basis}</p>}
      {f.note && <p className="note">메모: {f.note}</p>}
    </article>
  )
}

export default function GeneralReportView({ checklist, diag, client }: { checklist: GmChecklist; diag: Diagnosis; client: Client }) {
  const { user } = useAuth()
  const r = buildGeneralReport(checklist, diag, client)
  const unverified = checklist.areas.flatMap((a) => a.items).filter((i) => !i.verified_at).length
  const bad = r.findings.filter((f) => f.status === 'bad')
  const fix = r.findings.filter((f) => f.status === 'fix')

  return (
    <article className="report">
      <div className="report-actions no-print">
        <Link className="btn" to={`/diagnosis/${diag.id}`}>← 점검표 수정</Link>
        <button className="btn primary" onClick={() => window.print()}><Icon name="print" size={16} /> 인쇄 · PDF로 저장</button>
      </div>

      <header className="report-head">
        <p className="muted">{checklist.title} 보고서</p>
        <h1>{client.name}</h1>
        <p className="muted">점검일 {r.inspectDate || fmtDate(diag.updatedAt)} · 점검자 {user?.email} · {client.profile.industry} · 업력 {client.profile.business_age}년 · 근로자 {client.profile.employees}명</p>
      </header>

      <section className={`verdict v-${TONE[r.verdict.level]}`}>
        <div className="verdict-title">{r.verdict.title}</div>
        <p>{r.verdict.text}</p>
      </section>

      <section className="kpis">
        <LabelBox label="미흡(×)" tone={r.totals.bad ? 'red' : undefined}>{r.totals.bad}건</LabelBox>
        <LabelBox label="보완필요(△)" tone={r.totals.fix ? 'yellow' : undefined}>{r.totals.fix}건</LabelBox>
        <LabelBox label="양호(○)" tone="blue">{r.totals.ok}건</LabelBox>
        <LabelBox label="관리 수준" tone="hot">{r.managementScore === null ? '–' : `${r.managementScore}점`}</LabelBox>
        <LabelBox label="해당없음(—)">{r.totals.na}건</LabelBox>
        <LabelBox label="점검 진행">{r.answeredCount}/{r.totalCount}</LabelBox>
      </section>
      <p className="muted small">관리 수준은 해당없음을 뺀 점검 항목 중 양호는 1점, 보완필요는 0.5점으로 계산한 비율입니다.</p>

      <h2 className="section-title">영역별 점검 결과</h2>
      <div className="panel">
        {r.areas.map(({ area, counts }) => {
          const t = counts.total || 1
          return (
            <div key={area.id} className="gm-rep-row">
              <span className="cat-name">{area.id} {area.name.replace(' 관리', '')}</span>
              <div className="stack" role="img" aria-label={`양호 ${counts.ok}, 보완필요 ${counts.fix}, 미흡 ${counts.bad}, 해당없음 ${counts.na}, 미점검 ${counts.unanswered}`}>
                <i className="s-ok" style={{ width: `${(counts.ok / t) * 100}%` }} />
                <i className="s-fix" style={{ width: `${(counts.fix / t) * 100}%` }} />
                <i className="s-bad" style={{ width: `${(counts.bad / t) * 100}%` }} />
                <i className="s-na" style={{ width: `${(counts.na / t) * 100}%` }} />
              </div>
              <span className="cat-meta">○{counts.ok} △{counts.fix} ×{counts.bad} —{counts.na}{counts.unanswered ? ` · 미점검 ${counts.unanswered}` : ''}</span>
            </div>
          )
        })}
        <p className="small muted gm-rep-legend"><i className="s-ok" /> 양호 <i className="s-fix" /> 보완필요 <i className="s-bad" /> 미흡 <i className="s-na" /> 해당없음 (막대의 빈 부분은 미점검)</p>
      </div>

      {r.priorities.length > 0 && (
        <>
          <h2 className="section-title">개선 우선순위 TOP {r.priorities.length}</h2>
          <ol className="priority">
            {r.priorities.map((f) => (
              <li key={f.item.id}>
                <span className={`chip ${f.status === 'bad' ? 'chip-red' : 'chip-yellow'}`}>{STATUS_MARK[f.status]}</span> {f.item.text}
                <span className="muted small"> · {f.area.name}</span>
                <div className="small muted">{f.item.recommendation}</div>
              </li>
            ))}
          </ol>
        </>
      )}

      <h2 className="section-title">종합 코멘트</h2>
      <div className="panel">{r.summary ? <p className="pre">{r.summary}</p> : <p className="empty small">작성한 코멘트가 없습니다.</p>}</div>
      <p className="muted small">다음 점검 계획: {r.nextDate ? fmtDate(r.nextDate) : '미정'}</p>

      {bad.length > 0 && <><h2 className="section-title">미흡(×) 상세</h2>{bad.map((f) => <Finding key={f.item.id} f={f} />)}</>}
      {fix.length > 0 && <><h2 className="section-title">보완필요(△) 상세</h2>{fix.map((f) => <Finding key={f.item.id} f={f} />)}</>}

      {r.unanswered.length > 0 && (
        <>
          <h2 className="section-title">미점검 항목 ({r.unanswered.length})</h2>
          <div className="panel"><ul className="unanswered">{r.unanswered.map(({ item }) => <li key={item.id}><span className="qid">{item.id}</span> {item.text}</li>)}</ul></div>
        </>
      )}

      <footer className="report-foot small muted">
        이 보고서는 컨설턴트의 판단을 돕는 참고 자료이며 법률·세무·노무 자문을 대체하지 않습니다. 점검표는 초안 단계로 확인일이 없는 항목이 {unverified}/{r.totalCount}개입니다. 항목 문구·점검 포인트·권고·근거 조문은 컨설턴트 검토와 최신 법령 확인이 필요합니다.
      </footer>
    </article>
  )
}

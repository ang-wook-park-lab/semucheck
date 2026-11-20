import { Link, Navigate, useParams } from 'react-router-dom'
import { getDomain } from '../lib/checklists'
import { buildReport, signalOf, weightOf, type Finding, type VerdictLevel } from '../lib/report'
import { useData } from '../lib/useData'
import { useAuth } from '../lib/auth'
import { fmtDate, Icon, LabelBox, Progress, SignalChip } from '../components/ui'
import GeneralReportView from '../components/GeneralReportView'

const VERDICT_TONE: Record<VerdictLevel, string> = {
  blocked: 'red', hold: 'red', urgent: 'red', prepare: 'yellow', fix: 'yellow', incomplete: 'gray', immediate: 'blue', good: 'blue',
}

function FindingCard({ f }: { f: Finding }) {
  const it = f.item
  return (
    <article className={`finding f-${signalOf(it)}`}>
      <header>
        <span className="qid">{it.id}</span>
        <SignalChip signal={signalOf(it)} />
        <span className="weight">중요도 {weightOf(it)}</span>
      </header>
      <h4>{it.question}</h4>
      <p className="ans">응답: <b>{String(f.answer)}</b></p>
      <p className="rec"><b>개선 권고</b> {it.recommendation}</p>
      {it.consequence && <p className="small">불이익: {it.consequence}</p>}
      {it.legal_basis && <p className="small muted">근거: {it.legal_basis}</p>}
      {f.note && <p className="note">메모: {f.note}</p>}
    </article>
  )
}

function Bucket({ title, sub, list }: { title: string; sub: string; list: Finding[] }) {
  return (
    <div className="bucket">
      <div className="bucket-head"><b>{title}</b><span>{sub}</span></div>
      {list.length === 0 ? <p className="empty small">해당 없음</p> : <ol>{list.map((f) => <li key={f.item.id}>{f.item.question}</li>)}</ol>}
    </div>
  )
}

export default function ReportPage() {
  const { id } = useParams()
  const { clients, diagnoses, loading } = useData()
  const { user } = useAuth()
  if (loading) return <p className="empty">불러오는 중…</p>
  const diag = diagnoses.find((d) => d.id === id)
  const client = clients.find((c) => c.id === diag?.clientId)
  const domain = diag ? getDomain(diag.domain) : undefined
  if (!diag || !client || !domain) return <Navigate to="/diagnoses" replace />
  if (domain.kind === 'status' && domain.status) return <GeneralReportView checklist={domain.status} diag={diag} client={client} />

  const r = buildReport(domain.items, diag, client)
  const unverified = domain.items.filter((i) => !i.verified_at).length
  const pct = r.applicable.length ? Math.round((r.answeredCount / r.applicable.length) * 100) : 0

  return (
    <article className="report">
      <div className="report-actions no-print">
        <Link className="btn" to={`/diagnosis/${diag.id}`}>← 체크리스트 수정</Link>
        <button className="btn primary" onClick={() => window.print()}><Icon name="print" size={16} /> 인쇄 · PDF로 저장</button>
      </div>

      <header className="report-head">
        <div>
          <p className="muted">{domain.label} 진단 보고서</p>
          <h1>{client.name}</h1>
          <p className="muted">진단일 {fmtDate(diag.updatedAt)} · 담당 컨설턴트 {user?.email} · {client.profile.industry} · 업력 {client.profile.business_age}년 · 근로자 {client.profile.employees}명</p>
        </div>
      </header>

      <section className={`verdict v-${VERDICT_TONE[r.verdict.level]}`}>
        <div className="verdict-title">{r.verdict.title}</div>
        <p>{r.verdict.text}</p>
      </section>

      <section className="kpis">
        <LabelBox label="결격(빨강) 해당" tone={r.reds.length ? 'red' : undefined}>{r.reds.length}건</LabelBox>
        <LabelBox label="감점(노랑) 해당" tone={r.yellows.length ? 'yellow' : undefined}>{r.yellows.length}건</LabelBox>
        <LabelBox label="가점(파랑) 기회">{r.blues.length}건</LabelBox>
        <LabelBox label="리스크 지수" tone="hot">{r.riskIndex === null ? '–' : `${r.riskIndex}%`}</LabelBox>
        <LabelBox label="가점 확보율">{r.bonusRate === null ? '–' : `${r.bonusRate}%`}</LabelBox>
        <LabelBox label="응답률">{pct}%</LabelBox>
      </section>
      <p className="muted small">리스크 지수는 응답한 결격·감점 문항의 중요도 합계 중 해당된 비율입니다. 낮을수록 좋습니다.</p>

      <h2 className="section-title">카테고리별 현황</h2>
      <div className="panel cat-table">
        {r.categories.map((c) => (
          <div key={c.category} className="cat-row">
            <span className="cat-name">{c.category}</span>
            <Progress value={c.applicable ? (c.answered / c.applicable) * 100 : 0} />
            <span className="cat-meta">응답 {c.answered}/{c.applicable} · 해당 {c.flagged}건</span>
          </div>
        ))}
      </div>

      {r.priorities.length > 0 && (
        <>
          <h2 className="section-title">개선 우선순위 TOP {r.priorities.length}</h2>
          <ol className="priority">
            {r.priorities.map((f) => (
              <li key={f.item.id}>
                <SignalChip signal={signalOf(f.item)} /> {f.item.question}
                <div className="small muted">{f.item.recommendation}</div>
              </li>
            ))}
          </ol>
        </>
      )}

      <h2 className="section-title">보완 로드맵</h2>
      <div className="roadmap">
        <Bucket title="즉시" sub="결격 해소(신청 전 필수)" list={r.roadmap.now} />
        <Bucket title="3개월 이내" sub="영향이 큰 감점 요인" list={r.roadmap.threeMonths} />
        <Bucket title="결산 전" sub="그 밖의 감점 요인 정비" list={r.roadmap.yearEnd} />
        <Bucket title="인증·특허" sub="가점 확보 순서" list={r.roadmap.bonus} />
      </div>

      {r.fundMatches.length > 0 && (
        <>
          <h2 className="section-title">추천 자금 매칭</h2>
          <div className="panel">
            <ul className="matches">
              {r.fundMatches.map((m) => (
                <li key={m.title}><b>{m.title}</b> → {m.detail}</li>
              ))}
            </ul>
            <p className="small muted">금리·한도·요건은 공고에 따라 바뀝니다. 신청 전 해당 기관의 최신 공고 확인이 필요합니다.</p>
          </div>
        </>
      )}

      {r.reds.length > 0 && <><h2 className="section-title">결격(빨강) 상세</h2>{r.reds.map((f) => <FindingCard key={f.item.id} f={f} />)}</>}
      {r.yellows.length > 0 && <><h2 className="section-title">감점(노랑) 상세</h2>{r.yellows.map((f) => <FindingCard key={f.item.id} f={f} />)}</>}
      {r.blues.length > 0 && <><h2 className="section-title">가점(파랑) 기회 상세</h2>{r.blues.map((f) => <FindingCard key={f.item.id} f={f} />)}</>}

      {r.unanswered.length > 0 && (
        <>
          <h2 className="section-title">미응답 문항 ({r.unanswered.length})</h2>
          <div className="panel"><ul className="unanswered">{r.unanswered.map((i) => <li key={i.id}><span className="qid">{i.id}</span> {i.question}</li>)}</ul></div>
        </>
      )}

      <footer className="report-foot small muted">
        이 보고서는 컨설턴트의 판단을 돕는 참고 자료이며 법률·세무 자문을 대체하지 않습니다. 체크리스트는 초안 단계로 법령·공고 확인일이 없는 문항이 {unverified}/{domain.items.length}개입니다. 금액·비율·기준일은 신청 연도의 최신 법령과 공고로 확인하세요.
      </footer>
    </article>
  )
}

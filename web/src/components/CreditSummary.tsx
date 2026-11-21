import { evaluateCredit, RATING_FOCUS, SAME_NUMBER_NOTES, type RatioRow, type RatioStatus } from '../lib/credit'
import type { Answer, ChecklistItem } from '../lib/types'

const STATUS_LABEL: Record<RatioStatus, string> = { good: '양호', watch: '주의', bad: '위험', na: '입력 필요' }

function Score({ label, weight, value }: { label: string; weight: string; value: number | null }) {
  return (
    <div className="cs-bar" data-testid={`cs-${label}`}>
      <div className="cs-bar-head"><b>{label}</b><span className="muted small">비중 {weight}</span><b className="cs-bar-val">{value === null ? '–' : `${value}점`}</b></div>
      <div className="progress"><div className="progress-bar" style={{ width: `${value ?? 0}%` }} /></div>
    </div>
  )
}

function RatioTable({ rows }: { rows: RatioRow[] }) {
  const groups = ['성장성', '수익성', '안정성', '활동성', '5대 위험'] as const
  return (
    <table className="table ratio-table" data-testid="ratio-table">
      <thead><tr><th>구분</th><th>지표</th><th>현재</th><th>기준</th><th>판정</th></tr></thead>
      <tbody>
        {groups.flatMap((g) => rows.filter((r) => r.group === g).map((r, i, arr) => (
          <tr key={r.key} className={`rt-row rt-${r.status}`}>
            {i === 0 && <td rowSpan={arr.length} className="rt-group">{g}</td>}
            <td><b>{r.label}</b>{r.note && <div className="muted small">{r.note}</div>}</td>
            <td className="rt-val">{r.display}</td>
            <td className="small">{r.criterion}</td>
            <td><span className={`rt-chip rt-chip-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
          </tr>
        )))}
      </tbody>
    </table>
  )
}

/** 신용등급 진단 보고서 맨 위: 등급 준비도(참고용), 재무비율 분석, 5대 위험, 목표 달성 필요액, 신평사 중점 확인 */
export default function CreditSummary({ answers, items }: { answers: Record<string, Answer>; items: ChecklistItem[] }) {
  const r = evaluateCredit(answers, items)
  const tone = r.band.key === 'high' ? 'ok' : r.band.key === 'mid' ? 'check' : r.band.key === 'unknown' ? 'pending' : 'ng'
  return (
    <div className="credit-summary" data-testid="credit-summary">
      <h2 className="section-title">등급 준비도 (참고용 추정)</h2>
      <div className={`law-card law-${tone} cs-main`}>
        <div className="cs-score" data-testid="cs-total">
          <span className="cs-num">{r.scores.total === null ? '–' : r.scores.total}</span>
          <span className="cs-unit">점</span>
        </div>
        <div className="cs-main-text">
          <div className="law-head"><span className="law-name">{r.band.label}</span></div>
          <p>{r.band.text}</p>
          {r.capNote && <p className="small cs-cap" data-testid="cs-cap">{r.capNote}</p>}
          {r.goalGap && <p className="small muted">{r.goalGap}</p>}
        </div>
      </div>
      <div className="cs-bars">
        <Score label="재무" weight="70%" value={r.scores.financial} />
        <Score label="비재무" weight="25%" value={r.scores.nonfinancial} />
        <Score label="기술" weight="5%" value={r.scores.tech} />
      </div>
      <p className="muted small">책의 기업등급 구조(재무 70% + 비재무 25% + 기술 5%)와 재무비율 기준으로 계산한 <b>준비도 점수</b>입니다. 실제 신용평가회사(NICE평가정보·한국기업데이터·이크레더블)의 모형·등급과 다르며, 업종별 평균 비교는 반영하지 못합니다. [실무자 확인 필요]</p>

      <h2 className="section-title">재무비율 분석 <span className="muted small">입력한 재무 숫자 기준 · 계산 가능한 지표 {r.usableRatios}개</span></h2>
      <div className="panel"><RatioTable rows={r.ratios} /></div>

      {r.targets.length > 0 && (
        <>
          <h2 className="section-title">목표 기준을 맞추려면 (필요 개선액)</h2>
          <div className="panel" data-testid="credit-targets">
            <ul className="target-list">
              {r.targets.map((t) => <li key={t.label}><b>{t.label}</b><span>{t.text}</span></li>)}
            </ul>
            <p className="muted small">입력한 결산 숫자를 기준으로 한 단순 계산입니다. 실제 실행 방법과 세금 영향은 세무사와 사전 협의하세요.</p>
          </div>
        </>
      )}

      <h2 className="section-title">신용평가회사가 중점적으로 보는 것</h2>
      <div className="focus-grid">
        {RATING_FOCUS.map((g) => (
          <section key={g.title} className="focus-card">
            <h3>{g.title}</h3>
            <ul>{g.items.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
        ))}
      </div>
      <div className="notice">
        <b>같은 숫자라도 기관마다 다르게 봅니다</b>
        <ul className="law-list">{SAME_NUMBER_NOTES.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
    </div>
  )
}

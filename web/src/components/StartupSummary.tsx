import { COMPARE_ROWS, evaluateStartup, type LawResult, type LawStatus } from '../lib/startup'
import type { Answer } from '../lib/types'

const STATUS_LABEL: Record<LawStatus, string> = { ok: '창업 인정 가능', ng: '창업 불인정', check: '추가 확인', pending: '판정 보류' }

function LawCard({ r, testId }: { r: LawResult; testId: string }) {
  return (
    <section className={`law-card law-${r.status}`} data-testid={testId}>
      <div className="law-head">
        <span className="law-name">{r.law}</span>
        <span className={`law-chip law-chip-${r.status}`}>{STATUS_LABEL[r.status]}</span>
      </div>
      <p className="law-headline">{r.headline}</p>
      {r.reasons.length > 0 && (
        <ul className="law-list">
          {r.reasons.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
      {r.notes.length > 0 && (
        <ul className="law-list law-notes">
          {r.notes.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
    </section>
  )
}

/** 창업진단 보고서 맨 위: 법령별 창업 인정 여부, 청년·과밀억제권역, 세액감면 참고, 두 기준의 차이 */
export default function StartupSummary({ answers }: { answers: Record<string, Answer> }) {
  const s = evaluateStartup(answers)
  const youthTone = s.youth.status === 'yes' ? 'ok' : s.youth.status === 'no' ? 'ng' : 'check'
  const zoneTone = s.zone.zone === 'over' ? 'ng' : s.zone.zone === 'unknown' ? 'check' : 'ok'
  return (
    <div className="startup-summary" data-testid="startup-summary">
      <h2 className="section-title">법령별 창업 해당 여부</h2>
      <div className="law-grid">
        <LawCard r={s.support} testId="law-support" />
        <LawCard r={s.tax} testId="law-tax" />
      </div>
      {s.differences.length > 0 && (
        <div className="notice" data-testid="law-differences">
          <b>두 기준의 차이</b>
          <ul className="law-list">{s.differences.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}

      <div className="law-grid">
        <section className={`law-card law-${youthTone}`} data-testid="startup-youth">
          <div className="law-head"><span className="law-name">청년 여부</span><span className={`law-chip law-chip-${youthTone}`}>{s.youth.status === 'yes' ? '청년' : s.youth.status === 'no' ? '청년 아님' : s.youth.status === 'check' ? '확인 필요' : '미입력'}</span></div>
          <p>{s.youth.text}</p>
        </section>
        <section className={`law-card law-${zoneTone}`} data-testid="startup-zone">
          <div className="law-head"><span className="law-name">수도권과밀억제권역</span><span className={`law-chip law-chip-${zoneTone}`}>{s.zone.zone === 'over' ? '과밀억제권역' : s.zone.zone === 'metro' ? '수도권(과밀 외)' : s.zone.zone === 'non' ? '수도권 밖' : '미입력'}</span></div>
          <p>{s.zone.text}</p>
        </section>
      </div>

      <section className="law-card" data-testid="startup-benefit">
        <div className="law-head"><span className="law-name">세액감면 참고 (확정 아님)</span></div>
        <ul className="law-list">{s.benefit.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>

      <h2 className="section-title">정책자금(창업지원법)과 세법의 차이</h2>
      <div className="panel">
        <table className="table compare-table">
          <thead><tr><th>구분</th><th>정책자금 · 창업지원법</th><th>세법 · 조세특례제한법</th></tr></thead>
          <tbody>
            {COMPARE_ROWS.map((r) => (
              <tr key={r.topic}><td><b>{r.topic}</b></td><td>{r.support}</td><td>{r.tax}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">법령은 개정되고 해석이 갈릴 수 있습니다. 이 결과는 전문가 확인 전 참고용이며, 신청·신고 전에 국가법령정보센터의 현행 조문과 세무사·변호사 확인을 거치세요. [실무자 확인 필요]</p>
      </div>
    </div>
  )
}

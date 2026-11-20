import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { buildGeneralReport, isStatus, NOTE_DATE, NOTE_NEXT, NOTE_SUMMARY, STATUS_LABEL, STATUS_MARK } from '../lib/general'
import type { ReadyEditor } from '../lib/useDiagnosisEditor'
import type { GmChecklist, StatusCode } from '../lib/types'
import { fmtTime, LabelBox, Progress } from './ui'

const CODES: StatusCode[] = ['ok', 'fix', 'bad', 'na']
const today = () => new Date().toISOString().slice(0, 10)

/** ○△×— 상태 점검표 작성 화면 (법인 일반관리 64항목). 책의 점검표 서식(8영역 카드 + 결과 요약 + 종합 코멘트 + 개선 우선순위 TOP 5)을 따른다. */
export default function GeneralCheck({ ed, checklist }: { ed: ReadyEditor; checklist: GmChecklist }) {
  const { diag, client, savedAt, saveErr, setAnswer, setNote, finish } = ed
  const { user } = useAuth()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const r = buildGeneralReport(checklist, diag, client)
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="gm">
      <header className="gm-head">
        <div>
          <h1>{checklist.title}</h1>
          <p>{checklist.subtitle}</p>
        </div>
        <div className="gm-form">
          <LabelBox label="법인명">{client.name}</LabelBox>
          <LabelBox label="점검일자">
            <input type="date" value={diag.notes[NOTE_DATE] ?? today()} onChange={(e) => setNote(NOTE_DATE, e.target.value)} aria-label="점검일자" />
          </LabelBox>
          <LabelBox label="점검자">
            <span className="small">{user?.email}</span>
          </LabelBox>
        </div>
      </header>

      <div className="gm-bar">
        <div className="gm-legend" aria-label="상태 표시">
          <b>상태 표시</b>
          {CODES.map((c) => (
            <span key={c} className={`gm-leg gm-leg-${c}`}>{STATUS_MARK[c]} {STATUS_LABEL[c]}</span>
          ))}
        </div>
        <div className="gm-progress">
          <span>점검 {r.answeredCount} / {r.totalCount}</span>
          <Progress value={(r.answeredCount / r.totalCount) * 100} />
        </div>
        <div className="save-state" role="status">
          {saveErr ? <span className="msg error">{saveErr}</span> : savedAt ? `자동 저장됨 ${fmtTime(savedAt)}` : '변경 시 자동 저장'}
        </div>
        <button className="btn primary" onClick={() => finish('completed')}>점검 완료 · 보고서 보기</button>
      </div>

      <div className="gm-grid">
        {checklist.areas.map((area, ai) => {
          const sum = r.areas[ai].counts
          return (
            <section key={area.id} className={`gm-area gm-c${area.id}`} aria-label={area.name}>
              <h2 className="gm-area-head">
                <span className="gm-no">{area.id}</span> {area.name}
                <span className="gm-done">{sum.total - sum.unanswered}/{sum.total}</span>
              </h2>
              <ol className="gm-items">
                {area.items.map((it, n) => {
                  const v = diag.answers[it.id]
                  const status = isStatus(v) ? v : undefined
                  const expanded = open.has(it.id)
                  return (
                    <li key={it.id} className={`gm-row ${status ? `st-${status}` : ''}`}>
                      <div className="gm-line">
                        <span className="gm-n">{n + 1}</span>
                        <button type="button" className="gm-text" aria-expanded={expanded} onClick={() => toggle(it.id)} title="점검 포인트 보기">
                          {it.text}
                          {it.ocr_uncertain && <sup title="책 스캔 판독이 불확실한 문구">?</sup>}
                        </button>
                        <div className="gm-status" role="group" aria-label={`${it.text} 상태`}>
                          {CODES.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className={`gm-s gm-s-${c} ${status === c ? 'on' : ''}`}
                              aria-pressed={status === c}
                              aria-label={`${it.id} ${STATUS_LABEL[c]}`}
                              title={STATUS_LABEL[c]}
                              onClick={() => setAnswer(it.id, status === c ? undefined : c)}
                            >
                              {STATUS_MARK[c]}
                            </button>
                          ))}
                        </div>
                      </div>
                      {expanded && (
                        <div className="gm-detail">
                          <p><b>점검 포인트</b> {it.check}</p>
                          <p className="muted"><b>보완 시 권고</b> {it.recommendation}</p>
                          {it.legal_basis && <p className="small muted">근거: {it.legal_basis}</p>}
                          <input
                            className="memo"
                            placeholder="컨설턴트 메모 (보고서에 표시됩니다)"
                            value={diag.notes[it.id] ?? ''}
                            onChange={(e) => setNote(it.id, e.target.value)}
                            aria-label={`${it.id} 메모`}
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
              <p className="gm-key">핵심 포인트 | {area.key_point}</p>
            </section>
          )
        })}
      </div>

      <div className="gm-bottom">
        <section className="gm-box">
          <h2>점검 결과 요약</h2>
          <table className="table gm-sum">
            <thead>
              <tr><th>구분</th><th>항목 수</th><th>양호</th><th>보완필요</th><th>미흡</th><th>해당없음</th><th>미점검</th></tr>
            </thead>
            <tbody>
              {r.areas.map(({ area, counts }) => (
                <tr key={area.id}>
                  <td>{area.name.replace(' 관리', '')}</td>
                  <td>{counts.total}</td><td>{counts.ok}</td><td>{counts.fix}</td><td>{counts.bad}</td><td>{counts.na}</td><td>{counts.unanswered}</td>
                </tr>
              ))}
              <tr className="gm-total">
                <td>합계</td>
                <td>{r.totals.total}</td><td>{r.totals.ok}</td><td>{r.totals.fix}</td><td>{r.totals.bad}</td><td>{r.totals.na}</td><td>{r.totals.unanswered}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="gm-box">
          <h2>종합 코멘트</h2>
          <textarea
            value={diag.notes[NOTE_SUMMARY] ?? ''}
            onChange={(e) => setNote(NOTE_SUMMARY, e.target.value)}
            placeholder="종합 의견을 적으세요 (보고서에 표시됩니다)"
            rows={8}
            aria-label="종합 코멘트"
          />
        </section>
        <section className="gm-box">
          <h2>개선 우선순위 TOP 5</h2>
          {r.priorities.length === 0 ? (
            <p className="empty small">미흡·보완필요 항목이 없습니다.</p>
          ) : (
            <ol className="gm-top5">
              {r.priorities.map((f) => (
                <li key={f.item.id}><span className={`gm-s-mini gm-s-${f.status}`}>{STATUS_MARK[f.status]}</span> {f.item.text} <span className="muted small">({f.area.name.replace(' 관리', '')})</span></li>
              ))}
            </ol>
          )}
          <div className="gm-next">
            <label>다음 점검 계획 <input type="date" value={diag.notes[NOTE_NEXT] ?? ''} onChange={(e) => setNote(NOTE_NEXT, e.target.value)} aria-label="다음 점검 예정일" /></label>
          </div>
        </section>
      </div>
      <p className="muted small">모든 항목을 정기적으로 점검하고 미흡 항목은 즉시 개선 조치합니다. 항목 이름을 누르면 점검 포인트와 보완 권고가 펼쳐집니다.</p>
    </div>
  )
}

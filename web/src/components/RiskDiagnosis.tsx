import { useMemo, useState } from 'react'
import { buildEnv, isApplicable, signalOf, weightOf } from '../lib/report'
import { isRisk } from '../lib/rules'
import type { Domain } from '../lib/checklists'
import type { ReadyEditor } from '../lib/useDiagnosisEditor'
import type { Answer, ChecklistItem } from '../lib/types'
import { fmtTime, LabelBox, Progress, SignalChip } from './ui'

function AnswerInput({ item, value, onChange }: { item: ChecklistItem; value: Answer | undefined; onChange: (v: Answer | undefined) => void }) {
  if (item.answer_type === 'yes_no') {
    return (
      <div className="seg" role="group" aria-label="예/아니오">
        {['예', '아니오'].map((o) => (
          <button key={o} type="button" className={value === o ? 'on' : ''} aria-pressed={value === o} onClick={() => onChange(value === o ? undefined : o)}>
            {o}
          </button>
        ))}
      </div>
    )
  }
  if (item.answer_type === 'number') {
    return (
      <input
        className="num-input"
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        placeholder="숫자 입력"
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    )
  }
  if (item.answer_type === 'single_choice' && item.options) {
    return (
      <select className="choice" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">선택하세요</option>
        {item.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    )
  }
  return <input className="num-input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} placeholder="입력" />
}

/** 위험 규칙(risk_rule) 방식 체크리스트 작성 화면 (정책자금 등) */
export default function RiskDiagnosis({ ed, domain }: { ed: ReadyEditor; domain: Domain }) {
  const { diag, client, savedAt, saveErr, setAnswer, setNote, finish } = ed
  const [cat, setCat] = useState<string>('')

  const env = useMemo(() => buildEnv(client.profile, diag.answers), [client, diag])
  const applicable = useMemo(() => domain.items.filter((i) => isApplicable(i, env)), [domain, env])
  const categories = useMemo(() => [...new Set(applicable.map((i) => i.category))], [applicable])
  const activeCat = categories.includes(cat) ? cat : categories[0]

  const answeredIn = (items: ChecklistItem[]) => items.filter((i) => diag.answers[i.id] !== undefined && diag.answers[i.id] !== '').length
  const total = applicable.length
  const answered = answeredIn(applicable)
  const shown = applicable.filter((i) => i.category === activeCat)
  const excluded = domain.items.length - total

  return (
    <div className="diag-layout">
      <aside className="side-panel">
        <h3 className="panel-h">▸ 고객사</h3>
        <LabelBox label="고객사">{client.name}</LabelBox>
        <LabelBox label="업종">{client.profile.industry}</LabelBox>
        <LabelBox label="업력 · 근로자">{client.profile.business_age}년 · {client.profile.employees}명</LabelBox>
        <h3 className="panel-h">▸ 진행 현황</h3>
        <LabelBox label={`${domain.label} 응답`} tone="hot">{answered} / {total}</LabelBox>
        <Progress value={total ? (answered / total) * 100 : 0} />
        {excluded > 0 && <p className="muted small">고객사 조건에 따라 {excluded}문항 제외</p>}
        <h3 className="panel-h">▸ 카테고리</h3>
        <div className="cat-list">
          {categories.map((c) => {
            const items = applicable.filter((i) => i.category === c)
            const flagged = items.filter((i) => isRisk(i.risk_rule, diag.answers[i.id])).length
            return (
              <button key={c} className={`cat-btn ${c === activeCat ? 'on' : ''}`} onClick={() => setCat(c)}>
                <span>{c}</span>
                <span className="cat-count">
                  {flagged > 0 && <i className="dot" title="해당 문항 있음" />}
                  {answeredIn(items)}/{items.length}
                </span>
              </button>
            )
          })}
        </div>
        <div className="save-state" role="status">
          {saveErr ? <span className="msg error">{saveErr}</span> : savedAt ? `자동 저장됨 ${fmtTime(savedAt)}` : '변경 시 자동 저장'}
        </div>
        <button className="btn primary wide" onClick={() => finish('completed')}>진단 완료 · 보고서 보기</button>
        <button className="btn wide" onClick={() => finish(diag.status)}>저장하고 보고서 미리보기</button>
      </aside>

      <section className="questions">
        <h1 className="page-title">{domain.label} 체크리스트 <span className="muted">· {activeCat}</span></h1>
        {shown.map((item) => {
          const v = diag.answers[item.id]
          const sig = signalOf(item)
          const flagged = isRisk(item.risk_rule, v) === true
          return (
            <article key={item.id} className={`q ${flagged ? `flag-${sig}` : ''} ${v !== undefined ? 'done' : ''}`}>
              <header>
                <span className="qid">{item.id}</span>
                <SignalChip signal={sig} />
                <span className="weight">중요도 {weightOf(item)}</span>
                {flagged && <span className="hit">해당됨</span>}
              </header>
              <h3>{item.question}</h3>
              {item.help && <p className="help">{item.help}</p>}
              <AnswerInput item={item} value={v} onChange={(x) => setAnswer(item.id, x)} />
              {flagged && item.consequence && <p className="consequence">불이익: {item.consequence}</p>}
              <input
                className="memo"
                placeholder="컨설턴트 메모 (보고서에 표시됩니다)"
                value={diag.notes[item.id] ?? ''}
                onChange={(e) => setNote(item.id, e.target.value)}
                aria-label={`${item.id} 메모`}
              />
            </article>
          )
        })}
        <div className="next-row">
          {categories.indexOf(activeCat) < categories.length - 1 && (
            <button className="btn primary" onClick={() => { setCat(categories[categories.indexOf(activeCat) + 1]); window.scrollTo({ top: 0 }) }}>
              다음 카테고리 ›
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

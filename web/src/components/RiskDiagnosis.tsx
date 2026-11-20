import { useEffect, useMemo, useState } from 'react'
import { buildEnv, isApplicable, signalOf, weightOf } from '../lib/report'
import { isRisk } from '../lib/rules'
import { itemsForMode, type Domain } from '../lib/checklists'
import type { ReadyEditor } from '../lib/useDiagnosisEditor'
import type { Answer, ChecklistItem } from '../lib/types'
import DiagnosisExcel from './DiagnosisExcel'
import { usePhone } from '../lib/viewMode'
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
  const phone = usePhone()

  const env = useMemo(() => buildEnv(client.profile, diag.answers), [client, diag])
  const modeItems = useMemo(() => itemsForMode(domain, diag.mode), [domain, diag.mode])
  const applicable = useMemo(() => modeItems.filter((i) => isApplicable(i, env)), [modeItems, env])
  const categories = useMemo(() => [...new Set(applicable.map((i) => i.category))], [applicable])
  const activeCat = categories.includes(cat) ? cat : categories[0]

  const answeredIn = (items: ChecklistItem[]) => items.filter((i) => diag.answers[i.id] !== undefined && diag.answers[i.id] !== '').length
  const total = applicable.length
  const answered = answeredIn(applicable)
  const shown = applicable.filter((i) => i.category === activeCat)
  const excluded = modeItems.length - total
  const catIndex = categories.indexOf(activeCat)
  const goCat = (c: string) => {
    setCat(c)
    window.scrollTo({ top: 0 })
  }
  // 휴대폰: 고른 카테고리 칩이 막대 안에서 보이도록 가운데로 맞춘다
  useEffect(() => {
    if (phone) document.querySelector('.pcat-chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [phone, activeCat])

  const saveState = (
    <div className="save-state" role="status">
      {saveErr ? <span className="msg error">{saveErr}</span> : savedAt ? `자동 저장됨 ${fmtTime(savedAt)}` : '변경 시 자동 저장'}
    </div>
  )
  const actions = (
    <>
      {saveState}
      <button className="btn primary wide" onClick={() => finish('completed')}>진단 완료 · 보고서 보기</button>
      <button className="btn wide" onClick={() => finish(diag.status)}>저장하고 보고서 미리보기</button>
      <h3 className="panel-h">▸ 엑셀</h3>
      <DiagnosisExcel domain={domain} ed={ed} compact />
    </>
  )

  return (
    <div className={`diag-layout ${phone ? 'phone-diag' : ''}`}>
      {phone && (
        // 휴대폰: 질문이 맨 위에서 바로 보이도록, 진행 현황과 카테고리를 얇은 고정 막대로 줄인다
        <div className="phone-diag-bar" data-testid="phone-diag-bar">
          <div className="pdb-line">
            <span className="pdb-client">{client.name}</span>
            <span className={`pdb-mode ${diag.mode === 'quick' ? 'pdb-quick' : 'pdb-full'}`}>{diag.mode === 'quick' ? '간단' : '정밀'}</span>
            <span className="pdb-count">{answered}/{total}</span>
            <span className="pdb-save">{saveErr ? '저장 실패' : savedAt ? `저장 ${fmtTime(savedAt)}` : '자동 저장'}</span>
          </div>
          <Progress value={total ? (answered / total) * 100 : 0} />
          <div className="pcat-row" role="tablist" aria-label="카테고리">
            {categories.map((c) => {
              const items = applicable.filter((i) => i.category === c)
              const flagged = items.filter((i) => isRisk(i.risk_rule, diag.answers[i.id])).length
              return (
                <button key={c} type="button" role="tab" aria-selected={c === activeCat} className={`pcat-chip ${c === activeCat ? 'on' : ''}`} onClick={() => goCat(c)}>
                  {c} <small>{answeredIn(items)}/{items.length}</small>
                  {flagged > 0 && <i className="dot" title="해당 문항 있음" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {!phone && <aside className="side-panel">
        <h3 className="panel-h">▸ 고객사</h3>
        <LabelBox label="고객사">{client.name}</LabelBox>
        <LabelBox label="진단 방식">{diag.mode === 'quick' ? '간단 진단' : '정밀 진단'}</LabelBox>
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
        {actions}
      </aside>}

      <section className="questions">
        <h1 className="page-title">{domain.label} {diag.mode === 'quick' ? '간단진단' : '체크리스트'} <span className="muted">· {activeCat}</span></h1>
        {shown.map((item) => {
          const v = diag.answers[item.id]
          const sig = signalOf(item)
          const flagged = isRisk(item.risk_rule, v) === true
          return (
            <article key={item.id} className={`q ${flagged ? `flag-${sig}` : ''} ${v !== undefined ? 'done' : ''}`}>
              <header>
                <span className="qid">{item.id}</span>
                <SignalChip signal={sig} labels={domain.labels} />
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
          {phone && catIndex > 0 && (
            <button className="btn" onClick={() => goCat(categories[catIndex - 1])}>‹ 이전</button>
          )}
          {catIndex < categories.length - 1 && (
            <button className="btn primary" onClick={() => goCat(categories[catIndex + 1])}>
              다음 카테고리 ›
            </button>
          )}
        </div>
        {phone && <div className="phone-diag-actions" data-testid="phone-diag-actions">{actions}</div>}
      </section>
    </div>
  )
}

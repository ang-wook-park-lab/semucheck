import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { getDomain } from '../lib/checklists'
import { buildEnv, isApplicable, signalOf, weightOf } from '../lib/report'
import { isRisk } from '../lib/rules'
import { useData } from '../lib/useData'
import type { Answer, ChecklistItem, Diagnosis } from '../lib/types'
import { fmtTime, LabelBox, Progress, SignalChip } from '../components/ui'

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

export default function DiagnosisPage() {
  const { id } = useParams()
  const { clients, diagnoses, loading, store } = useData()
  const nav = useNavigate()
  const [diag, setDiag] = useState<Diagnosis | null>(null)
  const [cat, setCat] = useState<string>('')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const dirty = useRef(false)

  // 저장된 진단을 한 번만 불러온다. 이후 변경은 화면 상태가 기준(자동 저장).
  useEffect(() => {
    if (!diag) {
      const found = diagnoses.find((d) => d.id === id)
      if (found) setDiag(found)
    }
  }, [diagnoses, id, diag])

  // 변경 후 0.6초 뒤 자동 저장
  useEffect(() => {
    if (!diag || !dirty.current || !store) return
    const t = setTimeout(async () => {
      try {
        await store.saveDiagnosis({ ...diag, updatedAt: new Date().toISOString() })
        dirty.current = false
        setSavedAt(new Date())
        setSaveErr(null)
      } catch (e) {
        setSaveErr(e instanceof Error ? e.message : '저장하지 못했습니다.')
      }
    }, 600)
    return () => clearTimeout(t)
  }, [diag, store])

  const client = clients.find((c) => c.id === diag?.clientId)
  const domain = diag ? getDomain(diag.domain) : undefined

  const env = useMemo(() => (client && diag ? buildEnv(client.profile, diag.answers) : {}), [client, diag])
  const applicable = useMemo(() => (domain ? domain.items.filter((i) => isApplicable(i, env)) : []), [domain, env])
  const categories = useMemo(() => [...new Set(applicable.map((i) => i.category))], [applicable])
  const activeCat = categories.includes(cat) ? cat : categories[0]

  if (loading) return <p className="empty">불러오는 중…</p>
  if (!diag) return diagnoses.some((d) => d.id === id) ? null : <Navigate to="/diagnoses" replace />
  if (!client || !domain) return <Navigate to="/diagnoses" replace />

  const answeredIn = (items: ChecklistItem[]) => items.filter((i) => diag.answers[i.id] !== undefined && diag.answers[i.id] !== '').length
  const total = applicable.length
  const answered = answeredIn(applicable)

  const update = (patch: Partial<Diagnosis>) => {
    dirty.current = true
    setDiag((d) => (d ? { ...d, ...patch } : d))
  }
  const setAnswer = (itemId: string, v: Answer | undefined) => {
    const answers = { ...diag.answers }
    if (v === undefined) delete answers[itemId]
    else answers[itemId] = v
    update({ answers })
  }
  const setNote = (itemId: string, text: string) => {
    const notes = { ...diag.notes }
    if (text) notes[itemId] = text
    else delete notes[itemId]
    update({ notes })
  }
  async function finish(status: Diagnosis['status']) {
    if (!store || !diag) return
    try {
      await store.saveDiagnosis({ ...diag, status, updatedAt: new Date().toISOString() })
      dirty.current = false
      nav(`/report/${diag.id}`)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : '저장하지 못했습니다.')
    }
  }

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

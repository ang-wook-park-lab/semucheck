import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { resetChecklist, saveChecklist } from '../lib/admin'
import { validateRiskItems, validateStatusList } from '../lib/checklistValidate'
import { domains, type Domain } from '../lib/checklists'
import { useChecklistSync } from '../lib/checklistSync'
import { downloadBlob } from '../lib/download'
import { exportChecklistXlsx, parseChecklistXlsx, xlsxFileName, ExcelError, type ParsedChecklist } from '../lib/excel'
import { can } from '../lib/permissions'
import type { ChecklistItem, GmChecklist, GmItem, RiskLevel, Signal } from '../lib/types'
import FilePicker from '../components/FilePicker'
import ImportPreview from '../components/ImportPreview'
import Modal from '../components/Modal'
import { fmtDate, Icon, SignalChip } from '../components/ui'

interface Row {
  id: string
  cat: string
  title: string
  signal?: Signal
  level: RiskLevel
  quick: boolean
  rec: string
  verified: string
}

const LEVEL_LABEL: Record<RiskLevel, string> = { high: '높음', medium: '보통', low: '낮음' }
const errText = (e: unknown) => (e instanceof Error ? e.message : '처리하지 못했습니다.')

function rowsOf(d: Domain): Row[] {
  if (d.kind === 'status' && d.status)
    return d.status.areas.flatMap((a) =>
      a.items.map((i) => ({ id: i.id, cat: a.name, title: i.text, level: i.risk_level, quick: Boolean(i.quick), rec: i.recommendation, verified: i.verified_at ?? '' })),
    )
  return d.items.map((i) => ({ id: i.id, cat: i.category, title: i.question, signal: i.signal ?? 'yellow', level: i.risk_level, quick: Boolean(i.quick), rec: i.recommendation, verified: i.verified_at ?? '' }))
}

/** 저장하면 체크리스트가 바뀌어 화면이 다시 그려지므로, 안내 문구는 다시 그린 뒤에도 보이게 여기에 잠시 둔다 */
let flash: { kind: 'error' | 'info'; text: string } | null = null

export default function Checklists() {
  const { user, mode } = useAuth()
  const sync = useChecklistSync()
  const canEdit = can(user?.role, 'editChecklists') && mode === 'api'
  const ready = domains.filter((d) => d.ready || d.count > 0)
  // 선택한 분야는 주소(?d=)에 둔다: 저장 후 화면이 다시 그려져도 같은 분야에 머문다
  const [sp, setSp] = useSearchParams()
  const wanted = sp.get('d')
  const key = ready.some((x) => x.key === wanted) ? (wanted as string) : (ready[0]?.key ?? domains[0].key)
  const d = domains.find((x) => x.key === key) ?? domains[0]
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('')
  const [quickOnly, setQuickOnly] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [preview, setPreview] = useState<ParsedChecklist | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(() => {
    const f = flash
    flash = null
    return f
  })

  const rows = useMemo(() => rowsOf(d), [d])
  const cats = useMemo(() => [...new Set(rows.map((r) => r.cat))], [rows])
  const shown = rows.filter((r) => (!cat || r.cat === cat) && (!quickOnly || r.quick) && (!query || `${r.id} ${r.title}`.toLowerCase().includes(query.toLowerCase())))
  const unverified = rows.filter((r) => !r.verified).length
  const rejected = sync.rejected.find((r) => r.domain === d.key)

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      flash = { kind: 'info', text: ok }
      await sync.reload()
      setMsg({ kind: 'info', text: ok })
      return true
    } catch (e) {
      flash = null
      setMsg({ kind: 'error', text: errText(e) })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function onFile(f: File) {
    setMsg(null)
    try {
      setPreview(await parseChecklistXlsx(d, f))
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ExcelError ? e.message : '엑셀 파일을 읽지 못했습니다.' })
    }
  }

  const selectDomain = (k: string) => {
    setSp({ d: k }, { replace: true })
    setCat('')
    setQuery('')
    setQuickOnly(false)
    setOpenId(null)
    setMsg(null)
  }

  return (
    <>
      <h1 className="page-title">{canEdit ? '체크리스트 관리' : '체크리스트'}</h1>
      <p className="muted scope-note">
        {canEdit
          ? '문항을 고치거나 엑셀로 내려받아 수정한 뒤 다시 올릴 수 있습니다. 저장하면 모든 컨설턴트의 진단에 바로 반영됩니다(이미 입력한 응답은 문항 ID 기준으로 그대로 유지됩니다).'
          : '진단에 쓰는 체크리스트를 조회하고 엑셀로 내려받을 수 있습니다. 수정은 관리자만 할 수 있습니다.'}
      </p>

      <div className="tabs" role="tablist" aria-label="분야">
        {ready.map((x) => (
          <button key={x.key} role="tab" aria-selected={x.key === d.key} className={`tab ${x.key === d.key ? 'on' : ''}`} onClick={() => selectDomain(x.key)}>
            {x.label}
            <span className="tab-count">{x.count}</span>
            {x.override && <span className="chip chip-blue" title="관리자가 수정한 체크리스트를 사용 중">수정본</span>}
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="ck-summary">
          <span><b>전체 {d.count}{d.kind === 'status' ? '항목' : '문항'}</b></span>
          <span>간단진단 <b>{d.quickCount}</b></span>
          <span>법령·공고 확인일 없음 <b>{unverified}</b>/{rows.length}</span>
          {d.override ? (
            <span className="chip chip-blue" data-testid="override-info">수정본 사용 중 · {d.override.updatedBy} · {fmtDate(d.override.updatedAt)}</span>
          ) : (
            <span className="chip chip-gray">앱 기본 체크리스트</span>
          )}
        </div>
        {rejected && (
          <div className="notice" role="alert">
            저장된 수정본에 오류가 있어 기본 체크리스트를 쓰고 있습니다. 관리자가 엑셀을 고쳐 다시 올리세요.
            <ul>{rejected.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        {msg && <p className={`msg ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
        <div className="excel-row">
          <button className="btn small" onClick={async () => downloadBlob(await exportChecklistXlsx(d), xlsxFileName('체크리스트', d.label))}>
            <Icon name="download" size={15} /> 엑셀 다운로드
          </button>
          {canEdit && <FilePicker small label="엑셀 업로드(전체 교체)" onFile={(f) => void onFile(f)} disabled={busy} />}
          {canEdit && d.override && (
            <button
              className="btn small ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`${d.label} 체크리스트를 앱 기본값으로 되돌립니다. 수정한 내용은 사라집니다.`)) void run(() => resetChecklist(d.key).then(() => undefined), '기본 체크리스트로 되돌렸습니다.')
              }}
            >
              기본값으로 되돌리기
            </button>
          )}
        </div>
        {canEdit && <p className="muted small">엑셀 업로드는 이 분야의 체크리스트 <b>전체를 교체</b>합니다. 올리기 전에 변경 요약과 오류를 확인할 수 있고, 오류가 있으면 아무것도 바뀌지 않습니다. 열 설명은 내려받은 파일의 "안내" 시트에 있습니다.</p>}
      </div>

      <div className="filter-row">
        <input type="search" placeholder="문항 ID·내용 검색" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="검색" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="카테고리">
          <option value="">모든 {d.kind === 'status' ? '영역' : '카테고리'}</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={quickOnly} onChange={(e) => setQuickOnly(e.target.checked)} /> 간단진단 문항만</label>
        <span className="muted small">{shown.length}건 표시</span>
      </div>

      <div className="panel">
        <table className="table ck-table" data-testid="checklist-table">
          <thead>
            <tr><th>ID</th><th>{d.kind === 'status' ? '영역' : '카테고리'}</th><th>{d.kind === 'status' ? '점검 항목' : '질문'}</th><th>{d.kind === 'status' ? '위험도' : '신호'}</th><th>간단</th><th>확인일</th><th></th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <RowView key={r.id} r={r} d={d} open={openId === r.id} canEdit={canEdit} onToggle={() => setOpenId(openId === r.id ? null : r.id)} onEdit={() => setEditId(r.id)} />
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">조건에 맞는 문항이 없습니다.</p>}
      </div>

      {editId && canEdit && (
        <EditItem
          d={d}
          id={editId}
          busy={busy}
          onClose={() => setEditId(null)}
          onSave={async (data) => {
            const ok = await run(() => saveChecklist(d.key, data).then(() => undefined), '저장했습니다. 모든 진단에 반영됩니다.')
            if (ok) setEditId(null)
          }}
        />
      )}

      {preview && (
        <ImportPreview
          title={`${d.label} 체크리스트 엑셀 업로드`}
          errors={preview.errors}
          busy={busy}
          confirmLabel="이 내용으로 교체"
          onCancel={() => setPreview(null)}
          onConfirm={async () => {
            if (!preview.data) return
            const ok = await run(() => saveChecklist(d.key, preview.data).then(() => undefined), '엑셀 내용으로 체크리스트를 교체했습니다.')
            if (ok) setPreview(null)
          }}
        >
          {preview.summary && (
            <>
              <p>
                {d.label} 체크리스트를 <b>{preview.summary.total}{d.kind === 'status' ? '항목' : '문항'}</b>으로 교체합니다.
              </p>
              <div className="stat-row">
                <div className="labelbox"><div className="lb-label">추가</div><div className="lb-value">{preview.summary.added}</div></div>
                <div className="labelbox"><div className="lb-label">수정</div><div className="lb-value">{preview.summary.changed}</div></div>
                <div className="labelbox"><div className="lb-label">삭제</div><div className="lb-value">{preview.summary.removed}</div></div>
                <div className="labelbox"><div className="lb-label">그대로</div><div className="lb-value">{preview.summary.unchanged}</div></div>
              </div>
              {preview.summary.added + preview.summary.changed + preview.summary.removed === 0 && <p className="muted">현재 체크리스트와 달라지는 내용이 없습니다.</p>}
              {preview.summary.removed > 0 && <p className="muted small">삭제한 문항의 기존 응답은 데이터에는 남지만 보고서에는 나오지 않습니다.</p>}
            </>
          )}
        </ImportPreview>
      )}
    </>
  )
}

function RowView({ r, d, open, canEdit, onToggle, onEdit }: { r: Row; d: Domain; open: boolean; canEdit: boolean; onToggle(): void; onEdit(): void }) {
  const risk = d.items.find((i) => i.id === r.id)
  const gm = d.status?.areas.flatMap((a) => a.items).find((i) => i.id === r.id)
  return (
    <>
      <tr className={open ? 'open' : ''}>
        <td><span className="qid">{r.id}</span></td>
        <td>{r.cat}</td>
        <td><button className="link-cell" aria-expanded={open} onClick={onToggle}>{r.title}</button></td>
        <td>{r.signal ? <SignalChip signal={r.signal} labels={d.labels} /> : <span className="muted">{LEVEL_LABEL[r.level]}</span>}</td>
        <td>{r.quick && <span className="chip chip-quick">간단</span>}</td>
        <td className="small">{r.verified || <span className="muted">없음</span>}</td>
        <td className="row-actions">{canEdit && <button className="btn small" onClick={onEdit}>수정</button>}</td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={7}>
            <dl className="detail">
              {risk && (
                <>
                  {risk.help && <><dt>도움말</dt><dd>{risk.help}</dd></>}
                  <dt>응답</dt><dd>{risk.answer_type}{risk.options ? ` — ${risk.options.join(' / ')}` : ''}</dd>
                  {risk.applies_if && <><dt>적용 조건</dt><dd><code>{risk.applies_if}</code></dd></>}
                  <dt>위험 규칙</dt><dd><code>{risk.risk_rule}</code> · 중요도 {risk.score_weight ?? 1} · 위험도 {LEVEL_LABEL[risk.risk_level]}</dd>
                  {risk.consequence && <><dt>불이익</dt><dd>{risk.consequence}</dd></>}
                  {risk.legal_basis && <><dt>근거</dt><dd>{risk.legal_basis}</dd></>}
                  <dt>개선 권고</dt><dd>{risk.recommendation}</dd>
                  {risk.source && <><dt>출처</dt><dd>{risk.source}</dd></>}
                </>
              )}
              {gm && (
                <>
                  <dt>점검 포인트</dt><dd>{gm.check}</dd>
                  <dt>개선 권고</dt><dd>{gm.recommendation}</dd>
                  {gm.legal_basis && <><dt>근거</dt><dd>{gm.legal_basis}</dd></>}
                </>
              )}
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}

function EditItem({ d, id, busy, onClose, onSave }: { d: Domain; id: string; busy: boolean; onClose(): void; onSave(data: ChecklistItem[] | GmChecklist): Promise<void> }) {
  const risk = d.items.find((i) => i.id === id)
  const gm = d.status?.areas.flatMap((a) => a.items).find((i) => i.id === id)
  const [f, setF] = useState<Record<string, string | boolean>>((): Record<string, string | boolean> =>
    risk
      ? { question: risk.question, help: risk.help ?? '', recommendation: risk.recommendation, consequence: risk.consequence ?? '', legal_basis: risk.legal_basis ?? '', verified_at: risk.verified_at ?? '', signal: risk.signal ?? 'yellow', risk_level: risk.risk_level, score_weight: String(risk.score_weight ?? 1), quick: Boolean(risk.quick) }
      : { text: gm?.text ?? '', check: gm?.check ?? '', recommendation: gm?.recommendation ?? '', legal_basis: gm?.legal_basis ?? '', verified_at: gm?.verified_at ?? '', risk_level: gm?.risk_level ?? 'medium', quick: Boolean(gm?.quick) },
  )
  const [errors, setErrors] = useState<string[]>([])
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }))
  const text = (k: string) => String(f[k] ?? '')

  function save() {
    if (risk) {
      const w = Number(text('score_weight'))
      const next: ChecklistItem[] = d.items.map((i) =>
        i.id === id
          ? { ...i, question: text('question'), help: text('help'), recommendation: text('recommendation'), consequence: text('consequence'), legal_basis: text('legal_basis'), verified_at: text('verified_at'), signal: text('signal') as Signal, risk_level: text('risk_level') as RiskLevel, score_weight: Number.isFinite(w) ? w : 1, quick: Boolean(f.quick) || undefined }
          : i,
      )
      const errs = validateRiskItems(d.key, next)
      if (errs.length) return setErrors(errs)
      void onSave(next)
    } else if (d.status) {
      const data: GmChecklist = {
        ...d.status,
        areas: d.status.areas.map((a) => ({
          ...a,
          items: a.items.map((i): GmItem => (i.id === id ? { ...i, text: text('text'), check: text('check'), recommendation: text('recommendation'), legal_basis: text('legal_basis'), verified_at: text('verified_at'), risk_level: text('risk_level') as RiskLevel, quick: Boolean(f.quick) || undefined } : i)),
        })),
      }
      const errs = validateStatusList(d.key, data)
      if (errs.length) return setErrors(errs)
      void onSave(data)
    }
  }

  return (
    <Modal title={`문항 수정 — ${id}`} onClose={onClose} wide>
      <div className="form-stack">
        {risk ? (
          <>
            <label className="field">질문<textarea rows={2} value={text('question')} onChange={(e) => set('question', e.target.value)} aria-label="질문" /></label>
            <label className="field">도움말<textarea rows={2} value={text('help')} onChange={(e) => set('help', e.target.value)} /></label>
          </>
        ) : (
          <>
            <label className="field">점검 항목<input value={text('text')} onChange={(e) => set('text', e.target.value)} aria-label="점검 항목" /></label>
            <label className="field">점검 포인트<textarea rows={2} value={text('check')} onChange={(e) => set('check', e.target.value)} /></label>
          </>
        )}
        <label className="field">개선 권고<textarea rows={3} value={text('recommendation')} onChange={(e) => set('recommendation', e.target.value)} aria-label="개선 권고" /></label>
        {risk && <label className="field">불이익<input value={text('consequence')} onChange={(e) => set('consequence', e.target.value)} /></label>}
        <label className="field">근거 법령<input value={text('legal_basis')} onChange={(e) => set('legal_basis', e.target.value)} /></label>
        <div className="grid-4">
          <label className="field">확인일 <small>(YYYY-MM-DD)</small><input value={text('verified_at')} placeholder="비우면 미확인" onChange={(e) => set('verified_at', e.target.value)} aria-label="확인일" /></label>
          {risk && (
            <label className="field">
              신호
              <select value={text('signal')} onChange={(e) => set('signal', e.target.value)}>
                <option value="red">red · {d.labels.red}</option>
                <option value="yellow">yellow · {d.labels.yellow}</option>
                <option value="blue">blue · {d.labels.blue}</option>
              </select>
            </label>
          )}
          <label className="field">
            위험도
            <select value={text('risk_level')} onChange={(e) => set('risk_level', e.target.value)}>
              <option value="high">높음</option><option value="medium">보통</option><option value="low">낮음</option>
            </select>
          </label>
          {risk && <label className="field">중요도<input type="number" min={0} max={100} value={text('score_weight')} onChange={(e) => set('score_weight', e.target.value)} /></label>}
        </div>
        <label className="check"><input type="checkbox" checked={Boolean(f.quick)} onChange={(e) => set('quick', e.target.checked)} /> 간단진단에 포함</label>
        {risk && <p className="muted small">위험 규칙·적용 조건·선택지는 엑셀로 수정하세요(문법 검사가 함께 이뤄집니다). 현재 규칙: <code>{risk.risk_rule}</code></p>}
        {errors.length > 0 && <ul className="err-list">{errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}</ul>}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose} disabled={busy}>취소</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
      </div>
    </Modal>
  )
}

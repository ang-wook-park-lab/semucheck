// 엑셀(.xlsx) 업로드·다운로드. 브라우저와 Node(테스트)에서 같은 코드가 돈다.
//  - 업로드 파일은 브라우저에서 읽어 검증한 뒤 서버 API로 보낸다(서버가 한 번 더 검증한다).
//  - 파일 안의 문자열은 전부 값으로만 다룬다(수식은 실행하지 않는다).
//  - 오류가 하나라도 있으면 아무것도 적용하지 않고, 오류를 행 번호와 함께 모아서 돌려준다.
import { validateRiskItems, validateStatusList } from './checklistValidate'
import { getBundled, itemsForMode, statusForMode, type Domain } from './checklists'
import { STATUS_LABEL, STATUS_MARK, NOTE_DATE, NOTE_NEXT, NOTE_SUMMARY, isStatus, type GeneralReport } from './general'
import type { Report } from './report'
import { evaluateStartup } from './startup'
import { signalOf } from './report'
import type { Answer, ChecklistItem, Client, ClientProfile, Diagnosis, GmArea, GmChecklist, GmItem, StatusCode } from './types'

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_ROWS = 2000
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type Cell = string | number | null
interface Table {
  sheet: string
  header: string[]
  rows: Cell[][]
  widths?: number[]
  /** 사용자가 채우는 열(머리글 색을 다르게 표시) */
  inputColumns?: number[]
}

// ---------- 쓰기 ----------
const HEAD = { fontWeight: 'bold' as const, backgroundColor: '#DDE6F5', alignVertical: 'center' as const, wrap: true }
const INPUT_HEAD = { ...HEAD, backgroundColor: '#FFE9C7' }

function toSheet(t: Table) {
  const data = [
    t.header.map((h, i) => ({ value: h, ...(t.inputColumns?.includes(i) ? INPUT_HEAD : HEAD) })),
    ...t.rows.map((r) =>
      r.map((c) => {
        if (c === null || c === '') return null
        if (typeof c === 'number') return { value: c, type: Number, alignVertical: 'top' as const }
        return { value: c, wrap: true, alignVertical: 'top' as const }
      }),
    ),
  ]
  return { data, sheet: t.sheet, columns: (t.widths ?? t.header.map(() => 16)).map((width) => ({ width })), stickyRowsCount: 1 }
}

// 엑셀 라이브러리는 용량이 커서 실제로 엑셀 기능을 쓸 때만 내려받는다(첫 화면이 가볍게 열리도록).
async function writeWorkbook(tables: Table[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/universal')
  return writeXlsxFile(tables.map(toSheet) as never, {} as never).toBlob()
}

// ---------- 읽기 ----------
interface RawSheet {
  sheet: string
  rows: unknown[][]
}

async function readWorkbook(file: Blob | ArrayBuffer): Promise<RawSheet[]> {
  const size = file instanceof ArrayBuffer ? file.byteLength : file.size
  if (size > MAX_FILE_BYTES) throw new ExcelError(`파일이 너무 큽니다(최대 ${MAX_FILE_BYTES / 1024 / 1024}MB).`)
  let sheets: { sheet: string; data: unknown[][] }[]
  try {
    const { default: readXlsxFile } = await import('read-excel-file/universal')
    sheets = (await readXlsxFile(file as never)) as never
  } catch {
    throw new ExcelError('엑셀 파일(.xlsx)을 읽지 못했습니다. 파일이 손상됐거나 .xlsx 형식이 아닙니다.')
  }
  return sheets.map((s) => ({ sheet: s.sheet, rows: s.data }))
}

export class ExcelError extends Error {}

const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return ymd(v)
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)
  if (typeof v === 'boolean') return v ? 'Y' : ''
  return String(v).trim()
}
const isEmptyRow = (r: unknown[]) => r.every((c) => cellText(c) === '')
const YES = new Set(['y', 'yes', 'true', '1', 'o', '예', '있음', '해당'])
const NO = new Set(['', 'n', 'no', 'false', '0', 'x', '아니오', '없음', '해당없음'])
function parseFlag(v: string): boolean | null {
  const t = v.trim().toLowerCase()
  if (YES.has(t)) return true
  if (NO.has(t)) return false
  return null
}

interface Parsed {
  /** 엑셀의 실제 행 번호(1부터) */
  rowNo: number
  cells: Record<string, string>
}

/** 첫 비어 있지 않은 행을 머리글로 보고 열 이름으로 행을 읽는다 */
function readTable(sheet: RawSheet | undefined, required: string[], errors: string[]): Parsed[] {
  if (!sheet) {
    errors.push('시트를 찾을 수 없습니다.')
    return []
  }
  const hi = sheet.rows.findIndex((r) => !isEmptyRow(r))
  if (hi < 0) {
    errors.push('시트가 비어 있습니다.')
    return []
  }
  const header = sheet.rows[hi].map((c) => cellText(c))
  const missing = required.filter((h) => !header.includes(h))
  if (missing.length) {
    errors.push(`필수 열이 없습니다: ${missing.join(', ')} (양식의 머리글을 바꾸지 마세요).`)
    return []
  }
  const out: Parsed[] = []
  for (let i = hi + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i]
    if (isEmptyRow(r)) continue
    const cells: Record<string, string> = {}
    header.forEach((h, c) => {
      if (h) cells[h] = cellText(r[c])
    })
    out.push({ rowNo: i + 1, cells })
  }
  if (out.length > MAX_ROWS) {
    errors.push(`행이 너무 많습니다(최대 ${MAX_ROWS}행).`)
    return []
  }
  return out
}

const pickSheet = (sheets: RawSheet[], name: string) => sheets.find((s) => s.sheet === name) ?? sheets[0]
const todayStr = () => new Date().toISOString().slice(0, 10)
export const xlsxFileName = (...parts: string[]) => `${parts.join('_').replace(/[\\/:*?"<>|\s]+/g, '_')}_${todayStr()}.xlsx`
export { XLSX_MIME }

// =====================================================================
// 1) 체크리스트 (분야별)
// =====================================================================
const CK_RISK: [string, string][] = [
  ['문항ID', 'id'], ['카테고리', 'category'], ['질문', 'question'], ['도움말', 'help'], ['응답유형', 'answer_type'], ['선택지', 'options'],
  ['적용조건', 'applies_if'], ['위험규칙', 'risk_rule'], ['신호', 'signal'], ['위험도', 'risk_level'], ['중요도', 'score_weight'], ['간단진단', 'quick'],
  ['근거법령', 'legal_basis'], ['불이익', 'consequence'], ['개선권고', 'recommendation'], ['출처', 'source'], ['확인일', 'verified_at'],
]
const CK_RISK_REQUIRED = ['문항ID', '카테고리', '질문', '응답유형', '위험규칙', '신호', '위험도', '개선권고']
const CK_STATUS_HEAD = ['영역ID', '영역명', '핵심포인트', '항목ID', '점검항목', '점검포인트', '개선권고', '위험도', '간단진단', '근거법령', 'OCR불확실', '확인일']
const CK_STATUS_REQUIRED = ['영역ID', '영역명', '핵심포인트', '항목ID', '점검항목', '점검포인트', '개선권고', '위험도']

const GUIDE_RISK: Cell[][] = [
  ['이 파일은 체크리스트를 엑셀로 고치기 위한 양식입니다. "체크리스트" 시트를 수정해서 관리자 화면에서 업로드하세요.'],
  ['머리글(첫 행)은 바꾸지 마세요. 행을 추가·삭제하거나 순서를 바꿔도 됩니다. 업로드하면 이 파일의 내용으로 분야 전체가 교체됩니다(올리기 전에 변경 요약을 확인할 수 있습니다).'],
  [''],
  ['열', '설명'],
  ['문항ID', '영문·숫자·-·_ 30자 이하, 중복 불가. 다른 문항의 적용조건에서 이 ID를 참조합니다.'],
  ['응답유형', 'yes_no(예/아니오) / number(숫자) / single_choice(선택형)'],
  ['선택지', '선택형만 입력. 한 칸에 줄바꿈(Alt+Enter)으로 구분합니다.'],
  ['적용조건', '이 문항을 보여줄 조건. 예) employees >= 10 / business_type == \'법인\' / LAB-010 != \'개정 없음\'. 비워 두면 항상 보입니다. 쓸 수 있는 고객사 변수: business_type, business_age, employees, bookkeeping, has_research_lab, has_venture, planning_job_invention, industry'],
  ['위험규칙', "위험으로 판단하는 조건. answer 를 씁니다. 예) answer == '아니오' / answer > 200 / answer in ['A', 'B']. 위험 판정이 없는 정보 수집용 문항은 False 를 입력합니다."],
  ['신호', 'red(결격·위반 위험) / yellow(감점·보완 필요) / blue(가점·모범 사례)'],
  ['위험도', 'high / medium / low (개선 우선순위 정렬에 사용)'],
  ['중요도', '0~100 숫자(점수 가중치). 비우면 1'],
  ['간단진단', 'Y 로 표시한 문항이 "간단 진단"에 포함됩니다. 간단진단에 포함된 문항이 다른 문항을 조건으로 참조하면 그 문항도 Y 로 하세요.'],
  ['확인일', '법령·공고를 확인한 날짜(YYYY-MM-DD). 확인 전이면 비워 둡니다.'],
]
const GUIDE_STATUS: Cell[][] = [
  ['이 파일은 법인 일반관리 점검표(○△×—)를 엑셀로 고치기 위한 양식입니다. "점검표" 시트를 수정해서 관리자 화면에서 업로드하세요.'],
  ['머리글은 바꾸지 마세요. 영역은 영역ID가 같은 행끼리 묶이고, 파일에 나온 순서대로 표시됩니다.'],
  [''],
  ['열', '설명'],
  ['영역ID / 영역명 / 핵심포인트', '같은 영역의 행은 세 값이 같아야 합니다.'],
  ['항목ID', '영문·숫자·-·_ 30자 이하, 중복 불가'],
  ['위험도', 'high / medium / low (개선 우선순위 정렬에 사용)'],
  ['간단진단', 'Y 로 표시한 항목이 "간단 진단"에 포함됩니다.'],
  ['OCR불확실', '원본 책 스캔 문구가 불확실하면 Y'],
]

const optsToCell = (o?: string[]) => (o?.length ? o.join('\n') : '')
const yn = (b?: boolean) => (b ? 'Y' : '')

export async function exportChecklistXlsx(domain: Domain): Promise<Blob> {
  if (domain.kind === 'status' && domain.status) {
    const rows: Cell[][] = []
    for (const a of domain.status.areas)
      for (const it of a.items) rows.push([a.id, a.name, a.key_point, it.id, it.text, it.check, it.recommendation, it.risk_level, yn(it.quick), it.legal_basis ?? '', yn(it.ocr_uncertain), it.verified_at ?? ''])
    return writeWorkbook([
      { sheet: '점검표', header: CK_STATUS_HEAD, rows, widths: [8, 18, 24, 12, 30, 44, 50, 10, 10, 28, 10, 12] },
      { sheet: '안내', header: ['안내'], rows: GUIDE_STATUS.slice(), widths: [110, 60] },
    ])
  }
  const rows: Cell[][] = domain.items.map((it) => [
    it.id, it.category, it.question, it.help ?? '', it.answer_type, optsToCell(it.options), it.applies_if ?? '', it.risk_rule, it.signal ?? 'yellow', it.risk_level,
    it.score_weight ?? 1, yn(it.quick), it.legal_basis ?? '', it.consequence ?? '', it.recommendation, it.source ?? '', it.verified_at ?? '',
  ])
  return writeWorkbook([
    { sheet: '체크리스트', header: CK_RISK.map(([h]) => h), rows, widths: [11, 16, 44, 30, 13, 26, 30, 30, 9, 9, 8, 9, 28, 28, 50, 28, 12] },
    { sheet: '안내', header: ['안내'], rows: GUIDE_RISK.slice(), widths: [110, 90] },
  ])
}

export interface ChangeSummary {
  added: number
  changed: number
  removed: number
  unchanged: number
  total: number
}
export interface ParsedChecklist {
  errors: string[]
  data?: ChecklistItem[] | GmChecklist
  summary?: ChangeSummary
}

/** 비교용 정규형: 비어 있음(없음/빈 문자열)과 키 순서의 차이를 무시한다 */
const canonRisk = (it: ChecklistItem) =>
  JSON.stringify([it.id, it.category, it.question, it.help ?? '', it.answer_type, it.options ?? [], it.applies_if ?? '', it.risk_rule, it.signal ?? 'yellow', it.risk_level, it.score_weight ?? 1, Boolean(it.quick), it.legal_basis ?? '', it.consequence ?? '', it.recommendation, it.source ?? '', it.verified_at ?? ''])
type StatusRow = GmItem & { area: GmArea }
const canonStatus = (it: StatusRow) =>
  JSON.stringify([it.area.id, it.area.name, it.area.key_point, it.id, it.text, it.check, it.recommendation, it.risk_level, Boolean(it.quick), it.legal_basis ?? '', Boolean(it.ocr_uncertain), it.verified_at ?? ''])
const flatStatus = (g: GmChecklist): StatusRow[] => g.areas.flatMap((a) => a.items.map((i) => ({ ...i, area: a })))

function diffById<T extends { id: string }>(before: T[], after: T[], canon: (x: T) => string): ChangeSummary {
  const b = new Map(before.map((x) => [x.id, canon(x)]))
  let added = 0, changed = 0, unchanged = 0
  for (const x of after) {
    if (!b.has(x.id)) added++
    else if (b.get(x.id) === canon(x)) unchanged++
    else changed++
  }
  const ids = new Set(after.map((x) => x.id))
  const removed = before.filter((x) => !ids.has(x.id)).length
  return { added, changed, removed, unchanged, total: after.length }
}

const num = (s: string) => (s === '' ? null : Number(s))

export async function parseChecklistXlsx(domain: Domain, file: Blob | ArrayBuffer): Promise<ParsedChecklist> {
  const sheets = await readWorkbook(file)
  const errors: string[] = []
  if (domain.kind === 'status') {
    const rows = readTable(pickSheet(sheets, '점검표'), CK_STATUS_REQUIRED, errors)
    if (errors.length) return { errors }
    const base = domain.status ?? getBundled(domain.key).status
    if (!base) return { errors: ['이 분야의 점검표 원본을 찾을 수 없습니다.'] }
    const areas: GmArea[] = []
    for (const r of rows) {
      const c = r.cells
      let area = areas.find((a) => a.id === c['영역ID'])
      if (!area) {
        area = { id: c['영역ID'], name: c['영역명'], key_point: c['핵심포인트'], items: [] }
        areas.push(area)
      } else if (area.name !== c['영역명'] || area.key_point !== c['핵심포인트']) {
        errors.push(`${r.rowNo}행: 영역 ${c['영역ID']} 의 영역명·핵심포인트가 앞 행과 다릅니다.`)
      }
      const flag = (h: string) => {
        const f = parseFlag(c[h] ?? '')
        if (f === null) errors.push(`${r.rowNo}행: ${h} 은(는) Y 또는 빈 칸이어야 합니다.`)
        return f === true
      }
      const item: GmItem = {
        id: c['항목ID'], text: c['점검항목'], check: c['점검포인트'], recommendation: c['개선권고'], risk_level: c['위험도'] as GmItem['risk_level'],
      }
      if (c['근거법령']) item.legal_basis = c['근거법령']
      if (flag('OCR불확실')) item.ocr_uncertain = true
      if (flag('간단진단')) item.quick = true
      item.verified_at = c['확인일'] ?? ''
      area.items.push(item)
    }
    const data: GmChecklist = { ...base, areas }
    errors.push(...validateStatusList(domain.key, data))
    if (errors.length) return { errors }
    return { errors: [], data, summary: diffById(flatStatus(base), flatStatus(data), canonStatus) }
  }

  const rows = readTable(pickSheet(sheets, '체크리스트'), CK_RISK_REQUIRED, errors)
  if (errors.length) return { errors }
  const items: ChecklistItem[] = []
  for (const r of rows) {
    const c = r.cells
    const w = num(c['중요도'] ?? '')
    if (w !== null && Number.isNaN(w)) errors.push(`${r.rowNo}행: 중요도는 숫자여야 합니다.`)
    const q = parseFlag(c['간단진단'] ?? '')
    if (q === null) errors.push(`${r.rowNo}행: 간단진단은 Y 또는 빈 칸이어야 합니다.`)
    const options = (c['선택지'] ?? '').split(/\r?\n|\|/).map((s) => s.trim()).filter(Boolean)
    const it: ChecklistItem = {
      id: c['문항ID'], domain: domain.key, category: c['카테고리'], question: c['질문'], help: c['도움말'] ?? '',
      answer_type: c['응답유형'] as ChecklistItem['answer_type'], risk_rule: c['위험규칙'], signal: c['신호'] as ChecklistItem['signal'],
      risk_level: c['위험도'] as ChecklistItem['risk_level'], score_weight: w === null || Number.isNaN(w) ? 1 : w,
      legal_basis: c['근거법령'] ?? '', consequence: c['불이익'] ?? '', recommendation: c['개선권고'], source: c['출처'] ?? '', verified_at: c['확인일'] ?? '',
    }
    if (options.length) it.options = options
    if (c['적용조건']) it.applies_if = c['적용조건']
    if (q) it.quick = true
    items.push(it)
  }
  errors.push(...validateRiskItems(domain.key, items))
  if (errors.length) return { errors }
  // 간단진단: 포함한 문항이 참조하는 앞 질문이 빠져 있으면 알려 준다(후속 문항이 질문 없이 항상 보이게 됨)
  const quickIds = new Set(items.filter((i) => i.quick).map((i) => i.id))
  for (const it of items) {
    if (!it.quick || !it.applies_if) continue
    for (const ref of it.applies_if.match(/[A-Za-z]{2,5}-\d{1,4}/g) ?? []) {
      if (items.some((x) => x.id === ref) && !quickIds.has(ref)) errors.push(`${it.id}: 간단진단에 포함됐지만 적용조건이 참조하는 ${ref} 은(는) 간단진단에 없습니다. ${ref} 도 간단진단(Y)으로 하세요.`)
    }
  }
  if (errors.length) return { errors }
  const base = domain.items.length ? domain.items : getBundled(domain.key).items
  return { errors: [], data: items, summary: diffById(base, items, canonRisk) }
}

// =====================================================================
// 2) 고객사
// =====================================================================
const CL_HEAD = ['고객사ID', '고객사명', '업종', '사업자형태', '업력(년)', '상시근로자(명)', '장부방식', '연구소(Y/N)', '벤처(Y/N)', '직무발명도입계획(Y/N)']
const CL_OWNER = '담당컨설턴트(아이디)'
const CL_GUIDE: Cell[][] = [
  ['고객사 일괄 등록 양식입니다. "고객사" 시트에 한 줄에 한 고객사씩 입력해서 업로드하세요.'],
  ['고객사ID: 비워 두면 새 고객사로 등록, 다운로드한 파일의 ID를 그대로 두면 그 고객사를 수정합니다(컨설턴트는 자기 담당 고객사만 수정할 수 있습니다).'],
  ['사업자형태: 법인 / 개인   장부방식: 복식부기 / 간편장부   업력·상시근로자: 0 이상의 숫자   Y/N 열: Y 또는 N'],
  ['담당컨설턴트(아이디) 열은 관리자만 사용합니다. 비우면 업로드한 사람이 담당자가 됩니다.'],
]

export interface OwnerRef {
  id: string
  username: string
  name: string
}

export interface ClientImportRow {
  id?: string
  name: string
  profile: ClientProfile
  ownerId?: string
}

export async function exportClientsXlsx(clients: Client[], opts: { includeOwner: boolean; owners?: OwnerRef[]; template?: boolean }): Promise<Blob> {
  const header = opts.includeOwner ? [...CL_HEAD, CL_OWNER] : CL_HEAD
  const usernameOf = (id?: string) => opts.owners?.find((o) => o.id === id)?.username ?? ''
  const rows: Cell[][] = opts.template
    ? [['', '(주)예시상사', '제조업(C)', '법인', 3, 12, '복식부기', 'N', 'N', 'N', ...(opts.includeOwner ? [''] : [])]]
    : clients.map((c) => {
        const p = c.profile
        return [c.id, c.name, p.industry, p.business_type, p.business_age, p.employees, p.bookkeeping, p.has_research_lab ? 'Y' : 'N', p.has_venture ? 'Y' : 'N', p.planning_job_invention ? 'Y' : 'N', ...(opts.includeOwner ? [usernameOf(c.ownerId)] : [])]
      })
  return writeWorkbook([
    { sheet: '고객사', header, rows, widths: [38, 24, 22, 12, 10, 14, 12, 12, 10, 18, 28] },
    { sheet: '안내', header: ['안내'], rows: CL_GUIDE.slice(), widths: [120] },
  ])
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function parseClientsXlsx(file: Blob | ArrayBuffer, opts: { isAdmin: boolean; owners?: OwnerRef[] }): Promise<{ errors: string[]; rows: ClientImportRow[] }> {
  const sheets = await readWorkbook(file)
  const errors: string[] = []
  const table = readTable(pickSheet(sheets, '고객사'), ['고객사명', '업종', '사업자형태', '업력(년)', '상시근로자(명)', '장부방식'], errors)
  if (errors.length) return { errors, rows: [] }
  if (table.length === 0) return { errors: ['등록할 고객사 행이 없습니다.'], rows: [] }
  const rows: ClientImportRow[] = []
  const seen = new Set<string>()
  for (const r of table) {
    const c = r.cells
    const at = `${r.rowNo}행`
    const before = errors.length
    if (!c['고객사명'] || c['고객사명'].length > 200) errors.push(`${at}: 고객사명은 1~200자여야 합니다.`)
    if (c['업종'].length > 100) errors.push(`${at}: 업종이 너무 깁니다.`)
    if (!['법인', '개인'].includes(c['사업자형태'])) errors.push(`${at}: 사업자형태는 법인 또는 개인이어야 합니다.`)
    if (!['복식부기', '간편장부'].includes(c['장부방식'])) errors.push(`${at}: 장부방식은 복식부기 또는 간편장부여야 합니다.`)
    const age = Number(c['업력(년)'])
    const emp = Number(c['상시근로자(명)'])
    if (c['업력(년)'] === '' || !Number.isFinite(age) || age < 0 || age > 200) errors.push(`${at}: 업력(년)은 0 이상의 숫자여야 합니다.`)
    if (c['상시근로자(명)'] === '' || !Number.isFinite(emp) || emp < 0 || emp > 1_000_000) errors.push(`${at}: 상시근로자(명)는 0 이상의 숫자여야 합니다.`)
    const flags = (['연구소(Y/N)', '벤처(Y/N)', '직무발명도입계획(Y/N)'] as const).map((h) => {
      const f = parseFlag(c[h] ?? '')
      if (f === null) errors.push(`${at}: ${h} 은(는) Y 또는 N 이어야 합니다.`)
      return f === true
    })
    let id: string | undefined
    if (c['고객사ID']) {
      if (!UUID_RE.test(c['고객사ID'])) errors.push(`${at}: 고객사ID 형식이 올바르지 않습니다(다운로드한 값을 그대로 두거나 비워 두세요).`)
      else if (seen.has(c['고객사ID'].toLowerCase())) errors.push(`${at}: 고객사ID가 파일 안에서 중복됩니다.`)
      else {
        id = c['고객사ID'].toLowerCase()
        seen.add(id)
      }
    }
    let ownerId: string | undefined
    if (c[CL_OWNER]) {
      if (!opts.isAdmin) errors.push(`${at}: 담당컨설턴트는 관리자만 지정할 수 있습니다.`)
      else {
        const o = opts.owners?.find((x) => x.username.toLowerCase() === c[CL_OWNER].toLowerCase())
        if (!o) errors.push(`${at}: 담당컨설턴트 ${c[CL_OWNER]} 을(를) 찾을 수 없습니다(활성 상태의 관리자·컨설턴트 아이디).`)
        else ownerId = o.id
      }
    }
    if (errors.length === before)
      rows.push({
        ...(id ? { id } : {}),
        name: c['고객사명'],
        ...(ownerId ? { ownerId } : {}),
        profile: {
          industry: c['업종'] || '기타', business_type: c['사업자형태'] as ClientProfile['business_type'], business_age: age, employees: emp,
          bookkeeping: c['장부방식'] as ClientProfile['bookkeeping'], has_research_lab: flags[0], has_venture: flags[1], planning_job_invention: flags[2],
        },
      })
  }
  return { errors, rows: errors.length ? [] : rows }
}

// =====================================================================
// 3) 진단 응답 양식 (내려받아 채운 뒤 올리기)
// =====================================================================
const DG_HEAD = ['문항ID', '카테고리', '질문', '응답유형', '선택지', '응답(입력)', '메모', '도움말']
const DG_GUIDE: Cell[][] = [
  ['진단 응답 양식입니다. "응답(입력)" 열(주황색 머리글)과 "메모" 열만 채워서 업로드하세요. 다른 열을 바꿔도 반영되지 않습니다.'],
  ['yes_no: 예 / 아니오   number: 숫자   single_choice: "선택지" 열에 있는 값 중 하나(글자가 똑같아야 합니다).'],
  ['응답을 비워 두면 그 문항의 기존 응답이 지워집니다. 적용조건에 따라 해당 없는 문항은 화면에서 자동으로 숨겨집니다.'],
]
const ST_HEAD = ['항목ID', '영역', '점검항목', '상태(입력)', '메모', '점검포인트']
const ST_GUIDE: Cell[][] = [
  ['법인 일반관리 점검표 응답 양식입니다. "상태(입력)"(주황색)과 "메모" 열만 채우세요. "종합" 시트에서 점검일자·종합 코멘트·다음 점검일도 입력할 수 있습니다.'],
  ['상태: 양호 / 보완필요 / 미흡 / 해당없음 (○ △ × — 기호도 가능). 비워 두면 미점검으로 지워집니다.'],
]
const ST_SUMMARY_HEAD = ['항목', '내용']

const answerText = (a: Answer | undefined) => (a === undefined ? '' : a)

export async function exportDiagnosisXlsx(domain: Domain, diag: Diagnosis): Promise<Blob> {
  if (domain.kind === 'status' && domain.status) {
    const g = statusForMode(domain.status, diag.mode)
    const rows: Cell[][] = []
    for (const a of g.areas)
      for (const it of a.items) {
        const v = diag.answers[it.id]
        rows.push([it.id, a.name, it.text, isStatus(v) ? STATUS_LABEL[v] : '', diag.notes[it.id] ?? '', it.check])
      }
    return writeWorkbook([
      { sheet: '응답', header: ST_HEAD, rows, widths: [12, 18, 32, 14, 40, 60], inputColumns: [3, 4] },
      { sheet: '종합', header: ST_SUMMARY_HEAD, rows: [['점검일자', diag.notes[NOTE_DATE] ?? ''], ['종합코멘트', diag.notes[NOTE_SUMMARY] ?? ''], ['다음점검일', diag.notes[NOTE_NEXT] ?? '']], widths: [16, 90], inputColumns: [1] },
      { sheet: '안내', header: ['안내'], rows: ST_GUIDE.slice(), widths: [120] },
    ])
  }
  const rows: Cell[][] = itemsForMode(domain, diag.mode).map((it) => [
    it.id, it.category, it.question, it.answer_type, optsToCell(it.options), answerText(diag.answers[it.id]), diag.notes[it.id] ?? '', it.help ?? '',
  ])
  return writeWorkbook([
    { sheet: '응답', header: DG_HEAD, rows, widths: [11, 16, 50, 13, 28, 18, 36, 40], inputColumns: [5, 6] },
    { sheet: '안내', header: ['안내'], rows: DG_GUIDE.slice(), widths: [120] },
  ])
}

export interface ParsedDiagnosis {
  errors: string[]
  answers: Record<string, Answer>
  notes: Record<string, string>
  /** 현재 진단과 달라지는 응답·메모 수 */
  changes: number
}

const STATUS_BY_TEXT: Record<string, StatusCode> = {
  양호: 'ok', 보완필요: 'fix', 보완: 'fix', 미흡: 'bad', 해당없음: 'na',
  [STATUS_MARK.ok]: 'ok', [STATUS_MARK.fix]: 'fix', [STATUS_MARK.bad]: 'bad', [STATUS_MARK.na]: 'na', '-': 'na', O: 'ok', o: 'ok', X: 'bad', x: 'bad',
}

/** 업로드한 응답 양식을 현재 진단 위에 합쳐 돌려준다(저장은 호출하는 쪽이 한다) */
export async function parseDiagnosisXlsx(domain: Domain, current: Diagnosis, file: Blob | ArrayBuffer): Promise<ParsedDiagnosis> {
  const sheets = await readWorkbook(file)
  const errors: string[] = []
  const answers: Record<string, Answer> = { ...current.answers }
  const notes: Record<string, string> = { ...current.notes }

  if (domain.kind === 'status' && domain.status) {
    const g = statusForMode(domain.status, current.mode)
    const known = new Set(g.areas.flatMap((a) => a.items.map((i) => i.id)))
    const rows = readTable(sheets.find((s) => s.sheet === '응답') ?? sheets[0], ['항목ID', '상태(입력)'], errors)
    if (errors.length) return { errors, answers: current.answers, notes: current.notes, changes: 0 }
    let unknown = 0
    for (const r of rows) {
      const id = r.cells['항목ID']
      if (!known.has(id)) { unknown++; continue }
      const t = r.cells['상태(입력)']
      if (t === '') delete answers[id]
      else if (STATUS_BY_TEXT[t]) answers[id] = STATUS_BY_TEXT[t]
      else errors.push(`${r.rowNo}행(${id}): 상태는 양호 / 보완필요 / 미흡 / 해당없음 중 하나여야 합니다.`)
      const memo = r.cells['메모'] ?? ''
      if (memo.length > 500) errors.push(`${r.rowNo}행(${id}): 메모는 500자 이하여야 합니다.`)
      if (memo) notes[id] = memo
      else delete notes[id]
    }
    if (unknown === rows.length && rows.length > 0) errors.push('이 진단의 항목ID와 맞는 행이 없습니다. 다른 진단의 양식이거나 간단/전체 모드가 다를 수 있습니다.')
    const sum = sheets.find((s) => s.sheet === '종합')
    if (sum) {
      for (const r of sum.rows) {
        const k = cellText(r[0])
        const v = cellText(r[1])
        const key = k === '점검일자' ? NOTE_DATE : k === '종합코멘트' ? NOTE_SUMMARY : k === '다음점검일' ? NOTE_NEXT : null
        if (!key) continue
        if ((key === NOTE_DATE || key === NOTE_NEXT) && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`종합 시트: ${k} 은(는) YYYY-MM-DD 형식이어야 합니다.`)
        else if (v) notes[key] = v
        else delete notes[key]
      }
    }
    return finishDiagnosis(errors, current, answers, notes)
  }

  const items = itemsForMode(domain, current.mode)
  const byId = new Map(items.map((i) => [i.id, i]))
  const rows = readTable(sheets.find((s) => s.sheet === '응답') ?? sheets[0], ['문항ID', '응답(입력)'], errors)
  if (errors.length) return { errors, answers: current.answers, notes: current.notes, changes: 0 }
  let unknown = 0
  for (const r of rows) {
    const id = r.cells['문항ID']
    const it = byId.get(id)
    if (!it) { unknown++; continue }
    const t = r.cells['응답(입력)']
    const at = `${r.rowNo}행(${id})`
    if (t === '') delete answers[id]
    else if (it.answer_type === 'yes_no') {
      const f = parseFlag(t)
      if (f === null || t === '') errors.push(`${at}: 예 또는 아니오여야 합니다(입력값: ${t}).`)
      else answers[id] = f ? '예' : '아니오'
    } else if (it.answer_type === 'number') {
      const n = Number(t.replace(/,/g, ''))
      if (!Number.isFinite(n)) errors.push(`${at}: 숫자여야 합니다(입력값: ${t}).`)
      else answers[id] = n
    } else if (it.answer_type === 'single_choice') {
      if (!it.options?.includes(t)) errors.push(`${at}: 선택지 중 하나여야 합니다(입력값: ${t}). 가능한 값: ${(it.options ?? []).join(' / ')}`)
      else answers[id] = t
    }
    const memo = r.cells['메모'] ?? ''
    if (memo.length > 500) errors.push(`${at}: 메모는 500자 이하여야 합니다.`)
    if (memo) notes[id] = memo
    else delete notes[id]
  }
  if (unknown === rows.length && rows.length > 0) errors.push('이 진단의 문항ID와 맞는 행이 없습니다. 다른 진단의 양식이거나 간단/전체 모드가 다를 수 있습니다.')
  return finishDiagnosis(errors, current, answers, notes)
}

function finishDiagnosis(errors: string[], current: Diagnosis, answers: Record<string, Answer>, notes: Record<string, string>): ParsedDiagnosis {
  if (errors.length) return { errors, answers: current.answers, notes: current.notes, changes: 0 }
  const keys = new Set([...Object.keys(answers), ...Object.keys(current.answers)])
  let changes = 0
  for (const k of keys) if (answers[k] !== current.answers[k]) changes++
  const nkeys = new Set([...Object.keys(notes), ...Object.keys(current.notes)])
  for (const k of nkeys) if (notes[k] !== current.notes[k]) changes++
  return { errors: [], answers, notes, changes }
}

// =====================================================================
// 4) 보고서 (읽기 전용 내려받기)
// =====================================================================
export async function exportRiskReportXlsx(domain: Domain, client: Client, diag: Diagnosis, r: Report): Promise<Blob> {
  const L = domain.labels
  const startup = domain.key === 'startup' ? evaluateStartup(diag.answers) : null
  const summary: Cell[][] = [
    ['고객사', client.name], ['분야', domain.label], ['진단 방식', diag.mode === 'quick' ? '간단 진단' : '정밀 진단'], ['판정', r.verdict.title], ['판정 설명', r.verdict.text],
    [`${L.red} 해당`, r.reds.length], [`${L.yellow} 해당`, r.yellows.length], [`${L.blue} 기회`, r.blues.length],
    ['리스크 지수(%)', r.riskIndex ?? ''], [L.bonusRate + '(%)', r.bonusRate ?? ''],
    ['응답률(%)', r.applicable.length ? Math.round((r.answeredCount / r.applicable.length) * 100) : 0],
    ...(startup
      ? ([
          [startup.support.law, `${startup.support.headline} — ${[...startup.support.reasons, ...startup.support.notes].join(' / ')}`],
          [startup.tax.law, `${startup.tax.headline} — ${[...startup.tax.reasons, ...startup.tax.notes].join(' / ')}`],
          ['청년 여부', startup.youth.text],
          ['수도권과밀억제권역', startup.zone.text],
          ['세액감면 참고(확정 아님)', startup.benefit.join(' / ')],
          ['두 기준의 차이', startup.differences.join(' / ')],
        ] as Cell[][])
      : []),
  ]
  const label = { red: L.red, yellow: L.yellow, blue: L.blue }
  const found: Cell[][] = [...r.reds, ...r.yellows, ...r.blues].map((f) => [label[signalOf(f.item)], f.item.id, f.item.category, f.item.question, String(f.answer), f.item.recommendation, f.item.consequence ?? '', f.item.legal_basis ?? '', f.note ?? ''])
  const open: Cell[][] = r.unanswered.map((i) => [i.id, i.category, i.question])
  return writeWorkbook([
    { sheet: '요약', header: ['항목', '내용'], rows: summary, widths: [18, 90] },
    { sheet: '해당 항목', header: ['구분', '문항ID', '카테고리', '질문', '응답', '개선 권고', '불이익', '근거법령', '메모'], rows: found, widths: [12, 11, 16, 44, 14, 56, 30, 28, 30] },
    { sheet: '미응답', header: ['문항ID', '카테고리', '질문'], rows: open, widths: [11, 16, 70] },
  ])
}

export async function exportGeneralReportXlsx(domain: Domain, client: Client, diag: Diagnosis, r: GeneralReport): Promise<Blob> {
  const summary: Cell[][] = [
    ['고객사', client.name], ['분야', domain.label], ['진단 방식', diag.mode === 'quick' ? '간단 진단' : '정밀 진단'], ['판정', r.verdict.title], ['판정 설명', r.verdict.text],
    ['양호', r.totals.ok], ['보완필요', r.totals.fix], ['미흡', r.totals.bad], ['해당없음', r.totals.na], ['미점검', r.totals.unanswered],
    ['관리 수준(점)', r.managementScore ?? ''], ['점검일자', r.inspectDate], ['다음 점검일', r.nextDate], ['종합 코멘트', r.summary],
  ]
  const found: Cell[][] = r.findings.map((f) => [STATUS_LABEL[f.status], f.area.name, f.item.id, f.item.text, f.item.recommendation, f.item.legal_basis ?? '', f.note ?? ''])
  const open: Cell[][] = r.unanswered.map(({ area, item }) => [area.name, item.id, item.text])
  return writeWorkbook([
    { sheet: '요약', header: ['항목', '내용'], rows: summary, widths: [18, 90] },
    { sheet: '미흡·보완필요', header: ['상태', '영역', '항목ID', '점검항목', '개선 권고', '근거법령', '메모'], rows: found, widths: [12, 18, 12, 36, 56, 28, 30] },
    { sheet: '미점검', header: ['영역', '항목ID', '점검항목'], rows: open, widths: [18, 12, 60] },
  ])
}

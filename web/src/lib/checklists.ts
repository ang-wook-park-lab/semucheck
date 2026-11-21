import type { ChecklistItem, DiagnosisMode, GmChecklist } from './types'
import { validateRiskItems, validateStatusList } from './checklistValidate'

// 저장소 루트의 checklists/<분야>/*.json 을 빌드 시점에 읽는다(지식과 코드 분리).
// 위험 규칙 문항은 배열, 상태 점검표(○△×—)는 객체(areas)로 구분한다.
// 관리자가 화면·엑셀로 수정한 체크리스트는 서버에 저장되고, 로그인 후 applyOverrides()로 이 원본 위에 덮어쓴다.
const files = import.meta.glob('../../../checklists/*/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

export type DomainKind = 'risk' | 'status'

/** 신호등·로드맵에 쓰는 분야별 용어. 정책자금은 결격·감점·가점, 노무 등은 위반 위험·보완 필요·모범 사례 */
export interface Labels {
  red: string
  yellow: string
  blue: string
  bonusRate: string
  roadmap: { now: [string, string]; three: [string, string]; yearEnd: [string, string]; bonus: [string, string] }
}

export const POLICY_LABELS: Labels = {
  red: '결격', yellow: '감점', blue: '가점', bonusRate: '가점 확보율',
  roadmap: {
    now: ['즉시', '결격 해소(신청 전 필수)'],
    three: ['3개월 이내', '영향이 큰 감점 요인'],
    yearEnd: ['결산 전', '그 밖의 감점 요인 정비'],
    bonus: ['인증·특허', '가점 확보 순서'],
  },
}

/** 창업진단: 신호등은 "창업 인정" 관점으로 읽는다(빨강=창업 제외 사유, 노랑=추가 확인, 파랑=챙기면 좋은 것) */
export const STARTUP_LABELS: Labels = {
  red: '창업 제외 사유', yellow: '추가 확인', blue: '챙길 점', bonusRate: '챙긴 비율',
  roadmap: {
    now: ['설립·개시 전', '창업 제외 사유 해소(구조 재검토)'],
    three: ['신고·신청 전', '실질 판단이 필요한 사항 확인'],
    yearEnd: ['증빙 준비', '업종코드·주주·사업 이전 증빙 정비'],
    bonus: ['함께 챙기기', '창업기업 확인서·예비창업자 지원 등'],
  },
}

/** 기업신용등급 진단: 빨강=즉시 위험, 노랑=개선 필요, 파랑=가점 기회 */
export const CREDIT_LABELS: Labels = {
  red: '즉시 위험', yellow: '개선 필요', blue: '가점 기회', bonusRate: '가점 확보율',
  roadmap: {
    now: ['즉시', '가지급금·자본잠식 등 즉시 위험 해소'],
    three: ['3개월 이내', '가수금·개발비·영업이익 정리'],
    yearEnd: ['결산 전', '부채비율·유동성·회전율 정비(가결산)'],
    bonus: ['인증·특허·비재무', '가점 확보와 사업현황서 보강'],
  },
}

export const COMPLIANCE_LABELS: Labels = {
  red: '위반 위험', yellow: '보완 필요', blue: '모범 사례', bonusRate: '모범 사례 도입률',
  roadmap: {
    now: ['즉시', '법 위반 위험 해소'],
    three: ['3개월 이내', '영향이 큰 보완 과제'],
    yearEnd: ['연간 정비', '규정·서식·운영 개선'],
    bonus: ['모범 사례 도입', '추가하면 좋은 관리 체계'],
  },
}

export interface Domain {
  key: string
  label: string
  description: string
  kind: DomainKind
  labels: Labels
  /** kind === 'risk': 위험 규칙 문항 */
  items: ChecklistItem[]
  /** kind === 'status': ○△×— 상태 점검표 */
  status?: GmChecklist
  /** 화면에 보여줄 문항 수(정밀 진단) */
  count: number
  /** 간단진단에 포함된 문항 수 */
  quickCount: number
  /** 샘플 문항뿐이거나 비어 있으면 진단 시작 불가 */
  ready: boolean
  /** 관리자가 수정한 체크리스트를 쓰고 있으면 수정 정보 */
  override?: { updatedAt: string; updatedBy: string }
}

const META: Record<string, { label: string; description: string; kind: DomainKind; minItems: number; labels: Labels }> = {
  'policy-fund': { label: '정책자금', description: '정책자금·보증·인증·R&D 신청 가능성과 보완 과제', kind: 'risk', minItems: 10, labels: POLICY_LABELS },
  'corporate-general': { label: '법인 일반관리', description: '경영·재무·세무·노무·자금·계약·운영·문서 8개 영역 64항목 점검', kind: 'status', minItems: 1, labels: COMPLIANCE_LABELS },
  accounting: { label: '회계', description: '장부·증빙, 부가세·법인세·원천세, 결산, 가지급금 등 회계·세무 리스크 진단', kind: 'risk', minItems: 10, labels: COMPLIANCE_LABELS },
  credit: { label: '신용등급', description: '신용평가사가 보는 재무·비재무·기술 지표로 기업신용등급 진단과 개선 보고서', kind: 'risk', minItems: 10, labels: CREDIT_LABELS },
  startup: { label: '창업', description: '창업지원법·세법상 창업 해당 여부(폐업 후 재개·법인 전환·기존 주주), 청년·과밀억제권역 진단', kind: 'risk', minItems: 10, labels: STARTUP_LABELS },
  labor: { label: '노무', description: '취업규칙·근태·연차·괴롭힘·징계해고 등 노무 리스크 진단과 HR 경영보고', kind: 'risk', minItems: 10, labels: COMPLIANCE_LABELS },
}

// ---- 앱에 들어 있는 원본 ----
const bundledRisk: Record<string, ChecklistItem[]> = {}
const bundledStatus: Record<string, GmChecklist> = {}
for (const [path, data] of Object.entries(files)) {
  const key = path.split('/').slice(-2)[0]
  if (Array.isArray(data)) bundledRisk[key] = [...(bundledRisk[key] ?? []), ...(data as ChecklistItem[])]
  else if (data && typeof data === 'object' && 'areas' in data) bundledStatus[key] = data as GmChecklist
}

const statusItems = (g?: GmChecklist) => g?.areas.flatMap((a) => a.items) ?? []

function fill(d: Domain, items: ChecklistItem[], status?: GmChecklist) {
  const m = META[d.key]
  d.items = items
  d.status = status
  if (m.kind === 'status') {
    const all = statusItems(status)
    d.count = all.length
    d.quickCount = all.filter((i) => i.quick).length
    d.ready = all.length >= m.minItems
  } else {
    d.count = items.length
    d.quickCount = items.filter((i) => i.quick).length
    d.ready = items.length >= m.minItems
  }
}

/** 화면 전체가 같은 객체를 참조하므로 값을 바꿀 때는 제자리에서 바꾼다 */
export const domains: Domain[] = Object.entries(META).map(([key, m]) => {
  const d: Domain = { key, label: m.label, description: m.description, kind: m.kind, labels: m.labels, items: [], count: 0, quickCount: 0, ready: false }
  fill(d, m.kind === 'risk' ? (bundledRisk[key] ?? []) : [], m.kind === 'status' ? bundledStatus[key] : undefined)
  return d
})

export const allItems: ChecklistItem[] = domains.flatMap((d) => d.items)
function refreshAllItems() {
  allItems.length = 0
  allItems.push(...domains.flatMap((d) => d.items))
}

export function getDomain(key: string): Domain | undefined {
  return domains.find((d) => d.key === key)
}

/** 앱에 들어 있는 원본(관리자 수정 전). 엑셀 양식·변경 비교에 쓴다 */
export function getBundled(key: string): { items: ChecklistItem[]; status?: GmChecklist } {
  return { items: bundledRisk[key] ?? [], status: bundledStatus[key] }
}

export interface OverrideInput {
  data: unknown
  updatedAt: string
  updatedBy: string
}
export interface ApplyResult {
  applied: string[]
  rejected: { domain: string; errors: string[] }[]
}

/** 원본으로 되돌린다 */
export function resetOverrides() {
  for (const d of domains) {
    const m = META[d.key]
    fill(d, m.kind === 'risk' ? (bundledRisk[d.key] ?? []) : [], m.kind === 'status' ? bundledStatus[d.key] : undefined)
    d.override = undefined
  }
  refreshAllItems()
}

/**
 * 서버에 저장된 수정본을 원본 위에 적용한다. 검증을 통과하지 못한 분야는 적용하지 않고 원본을 쓴다
 * (잘못된 데이터가 모두의 화면을 깨뜨리지 않도록).
 */
export function applyOverrides(overrides: Record<string, OverrideInput>): ApplyResult {
  resetOverrides()
  const result: ApplyResult = { applied: [], rejected: [] }
  for (const [key, ov] of Object.entries(overrides)) {
    const d = getDomain(key)
    if (!d) continue
    const errors = d.kind === 'risk' ? validateRiskItems(key, ov.data) : validateStatusList(key, ov.data)
    if (errors.length) {
      result.rejected.push({ domain: key, errors })
      continue
    }
    if (d.kind === 'risk') fill(d, ov.data as ChecklistItem[])
    else fill(d, [], ov.data as GmChecklist)
    d.override = { updatedAt: ov.updatedAt, updatedBy: ov.updatedBy }
    result.applied.push(key)
  }
  refreshAllItems()
  return result
}

// ---- 진단 모드(전체 / 간단) ----
/** 진단 모드에 맞는 위험 규칙 문항. 간단진단은 quick 표시가 있는 문항만 */
export function itemsForMode(d: Domain, mode: DiagnosisMode | undefined): ChecklistItem[] {
  return mode === 'quick' ? d.items.filter((i) => i.quick) : d.items
}

/** 진단 모드에 맞는 상태 점검표. 간단진단은 quick 항목만 남기고 빈 영역은 뺀다 */
export function statusForMode(g: GmChecklist, mode: DiagnosisMode | undefined): GmChecklist {
  if (mode !== 'quick') return g
  const areas = g.areas.map((a) => ({ ...a, items: a.items.filter((i) => i.quick) })).filter((a) => a.items.length > 0)
  return { ...g, areas }
}

/** 모드별 문항 수 */
export function modeCount(d: Domain, mode: DiagnosisMode): number {
  return mode === 'quick' ? d.quickCount : d.count
}

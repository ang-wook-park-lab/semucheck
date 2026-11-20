import type { ChecklistItem, GmChecklist } from './types'

// 저장소 루트의 checklists/<분야>/*.json 을 빌드 시점에 읽는다(지식과 코드 분리).
// 위험 규칙 문항은 배열, 상태 점검표(○△×—)는 객체(areas)로 구분한다.
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
  /** 화면에 보여줄 문항 수 */
  count: number
  /** 샘플 문항뿐이거나 비어 있으면 진단 시작 불가 */
  ready: boolean
}

const META: Record<string, { label: string; description: string; kind: DomainKind; minItems: number; labels: Labels }> = {
  'policy-fund': { label: '정책자금', description: '정책자금·보증·인증·R&D 신청 가능성과 보완 과제', kind: 'risk', minItems: 10, labels: POLICY_LABELS },
  'corporate-general': { label: '법인 일반관리', description: '경영·재무·세무·노무·자금·계약·운영·문서 8개 영역 64항목 점검', kind: 'status', minItems: 1, labels: COMPLIANCE_LABELS },
  accounting: { label: '회계', description: '장부·증빙, 부가세·법인세·원천세, 결산, 가지급금 등 회계·세무 리스크 진단', kind: 'risk', minItems: 10, labels: COMPLIANCE_LABELS },
  labor: { label: '노무', description: '취업규칙·근태·연차·괴롭힘·징계해고 등 노무 리스크 진단과 HR 경영보고', kind: 'risk', minItems: 10, labels: COMPLIANCE_LABELS },
}

const riskItems: Record<string, ChecklistItem[]> = {}
const statusLists: Record<string, GmChecklist> = {}
for (const [path, data] of Object.entries(files)) {
  const key = path.split('/').slice(-2)[0]
  if (Array.isArray(data)) riskItems[key] = [...(riskItems[key] ?? []), ...(data as ChecklistItem[])]
  else if (data && typeof data === 'object' && 'areas' in data) statusLists[key] = data as GmChecklist
}

export const domains: Domain[] = Object.entries(META).map(([key, m]) => {
  if (m.kind === 'status') {
    const status = statusLists[key]
    const count = status ? status.areas.reduce((n, a) => n + a.items.length, 0) : 0
    return { key, label: m.label, description: m.description, kind: m.kind, labels: m.labels, items: [], status, count, ready: count >= m.minItems }
  }
  const items = riskItems[key] ?? []
  return { key, label: m.label, description: m.description, kind: m.kind, labels: m.labels, items, count: items.length, ready: items.length >= m.minItems }
})

export const allItems: ChecklistItem[] = domains.flatMap((d) => d.items)

export function getDomain(key: string): Domain | undefined {
  return domains.find((d) => d.key === key)
}

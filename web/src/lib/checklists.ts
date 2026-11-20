import type { ChecklistItem, GmChecklist } from './types'

// 저장소 루트의 checklists/<분야>/*.json 을 빌드 시점에 읽는다(지식과 코드 분리).
// 위험 규칙 문항은 배열, 상태 점검표(○△×—)는 객체(areas)로 구분한다.
const files = import.meta.glob('../../../checklists/*/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

export type DomainKind = 'risk' | 'status'

export interface Domain {
  key: string
  label: string
  description: string
  kind: DomainKind
  /** kind === 'risk': 위험 규칙 문항 */
  items: ChecklistItem[]
  /** kind === 'status': ○△×— 상태 점검표 */
  status?: GmChecklist
  /** 화면에 보여줄 문항 수 */
  count: number
  /** 샘플 문항뿐이거나 비어 있으면 진단 시작 불가 */
  ready: boolean
}

const META: Record<string, { label: string; description: string; kind: DomainKind; minItems: number }> = {
  'policy-fund': { label: '정책자금', description: '정책자금·보증·인증·R&D 신청 가능성과 보완 과제', kind: 'risk', minItems: 10 },
  'corporate-general': { label: '법인 일반관리', description: '경영·재무·세무·노무·자금·계약·운영·문서 8개 영역 64항목 점검', kind: 'status', minItems: 1 },
  accounting: { label: '회계', description: '결산·재무제표·세무 리스크 진단', kind: 'risk', minItems: 10 },
  labor: { label: '노무', description: '근로계약·임금·4대보험 등 노무 리스크 진단', kind: 'risk', minItems: 10 },
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
    return { key, label: m.label, description: m.description, kind: m.kind, items: [], status, count, ready: count >= m.minItems }
  }
  const items = riskItems[key] ?? []
  return { key, label: m.label, description: m.description, kind: m.kind, items, count: items.length, ready: items.length >= m.minItems }
})

export const allItems: ChecklistItem[] = domains.flatMap((d) => d.items)

export function getDomain(key: string): Domain | undefined {
  return domains.find((d) => d.key === key)
}

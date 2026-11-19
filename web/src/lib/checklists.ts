import type { ChecklistItem } from './types'

// 저장소 루트의 checklists/<분야>/*.json 을 빌드 시점에 읽는다(지식과 코드 분리).
const files = import.meta.glob('../../../checklists/*/*.json', { eager: true, import: 'default' }) as Record<
  string,
  ChecklistItem[]
>

export interface Domain {
  key: string
  label: string
  description: string
  items: ChecklistItem[]
  /** 샘플 문항뿐이거나 비어 있으면 진단 시작 불가 */
  ready: boolean
}

const META: Record<string, { label: string; description: string; minItems: number }> = {
  'policy-fund': { label: '정책자금', description: '정책자금·보증·인증·R&D 신청 가능성과 보완 과제', minItems: 10 },
  accounting: { label: '회계', description: '결산·재무제표·세무 리스크 진단', minItems: 10 },
  labor: { label: '노무', description: '근로계약·임금·4대보험 등 노무 리스크 진단', minItems: 10 },
}

const byDomain: Record<string, ChecklistItem[]> = {}
for (const [path, items] of Object.entries(files)) {
  const key = path.split('/').slice(-2)[0]
  byDomain[key] = [...(byDomain[key] ?? []), ...items]
}

export const domains: Domain[] = Object.entries(META).map(([key, m]) => {
  const items = byDomain[key] ?? []
  return { key, label: m.label, description: m.description, items, ready: items.length >= m.minItems }
})

export const allItems: ChecklistItem[] = domains.flatMap((d) => d.items)

export function getDomain(key: string): Domain | undefined {
  return domains.find((d) => d.key === key)
}

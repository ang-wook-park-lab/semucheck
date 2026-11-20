import { isRisk } from './rules'
import type { Answer, ChecklistItem } from './types'

const NUMS = [-1, 0, 1, 2, 3, 4, 5, 6, 39, 40, 41, 69, 70, 84, 85, 99, 100, 101, 200, 201, 1000]

export function candidates(it: ChecklistItem): Answer[] {
  if (it.answer_type === 'yes_no') return ['예', '아니오']
  if (it.answer_type === 'number') return NUMS
  return it.options ?? []
}

/** 위험 규칙에 해당(risky=true)하거나 해당하지 않는(false) 답 하나를 찾는다 */
export const firstWhere = (it: ChecklistItem, risky: boolean) => candidates(it).find((a) => (isRisk(it.risk_rule, a) === true) === risky)

/** 모든 문항에 위험하지 않은 답을 채운다 */
export function safeAnswers(items: ChecklistItem[]): Record<string, Answer> {
  const a: Record<string, Answer> = {}
  for (const it of items) {
    const v = firstWhere(it, false)
    if (v !== undefined) a[it.id] = v
  }
  return a
}

import { describe, expect, it } from 'vitest'
import { domains, getDomain, itemsForMode, modeCount, statusForMode } from './checklists'
import { buildReport } from './report'
import { safeAnswers } from './testutil'
import { EMPTY_PROFILE } from '../components/ClientForm'
import type { Client, Diagnosis } from './types'

const REF = /\b([A-Z]{3,4}-\d{3})\b/g
const risk = domains.filter((d) => d.kind === 'risk' && d.ready)
const client: Client = { id: 'c', name: '간단진단', profile: { ...EMPTY_PROFILE, employees: 80 }, createdAt: '' }
const diag = (domain: string, answers: Diagnosis['answers']): Diagnosis => ({ id: 'd', clientId: 'c', domain, answers, notes: {}, status: 'in_progress', mode: 'quick', createdAt: '', updatedAt: '' })

describe('간단진단 문항 구성', () => {
  for (const d of domains.filter((x) => x.ready)) {
    it(`${d.label}: 전체보다 적고(20~50%) 비어 있지 않다`, () => {
      expect(d.quickCount).toBeGreaterThan(0)
      expect(d.quickCount).toBeLessThan(d.count)
      const ratio = d.quickCount / d.count
      expect(ratio).toBeGreaterThanOrEqual(0.2)
      expect(ratio).toBeLessThanOrEqual(0.5)
      expect(modeCount(d, 'quick')).toBe(d.quickCount)
      expect(modeCount(d, 'full')).toBe(d.count)
    })
  }

  for (const d of risk) {
    it(`${d.label}: 간단진단 문항이 참조하는 앞 질문도 간단진단에 있다`, () => {
      const quickIds = new Set(d.items.filter((i) => i.quick).map((i) => i.id))
      const allIds = new Set(d.items.map((i) => i.id))
      for (const it of d.items.filter((i) => i.quick && i.applies_if)) {
        for (const ref of it.applies_if!.match(REF) ?? []) {
          if (allIds.has(ref)) expect(quickIds.has(ref), `${it.id} → ${ref}`).toBe(true)
        }
      }
    })
    it(`${d.label}: 카테고리마다 간단진단 문항이 하나 이상 있다(개인사업자 전용 제외)`, () => {
      const cats = new Set(d.items.map((i) => i.category))
      for (const c of cats) expect(d.items.some((i) => i.category === c && i.quick), c).toBe(true)
    })
    it(`${d.label}: 간단진단 모드의 문항은 itemsForMode 와 일치`, () => {
      expect(itemsForMode(d, 'quick').map((i) => i.id)).toEqual(d.items.filter((i) => i.quick).map((i) => i.id))
      expect(itemsForMode(d, 'full')).toBe(d.items)
      expect(itemsForMode(d, undefined)).toBe(d.items)
    })
  }

  it('법인 일반관리: 간단진단은 모든 영역에서 항목을 고르고 빈 영역이 없다', () => {
    const d = getDomain('corporate-general')!
    const q = statusForMode(d.status!, 'quick')
    expect(q.areas).toHaveLength(d.status!.areas.length)
    expect(q.areas.every((a) => a.items.length >= 1)).toBe(true)
    expect(q.areas.flatMap((a) => a.items)).toHaveLength(d.quickCount)
    expect(statusForMode(d.status!, 'full')).toBe(d.status)
  })
})

describe('간단진단에서도 정책자금 판정이 동작한다', () => {
  const d = getDomain('policy-fund')!
  const items = itemsForMode(d, 'quick')
  const base = {
    ...safeAnswers(items),
    'FUND-017': 3, 'FUND-023': '증가', 'FUND-042': '예', 'FUND-034': '예',
  }
  it('필수 판정 문항이 모두 간단진단에 있다', () => {
    const ids = new Set(items.map((i) => i.id))
    for (const id of ['FUND-001', 'FUND-004', 'FUND-005', 'FUND-006', 'FUND-016', 'FUND-017', 'FUND-023', 'FUND-033', 'FUND-034', 'FUND-035', 'FUND-036', 'FUND-042']) expect(ids.has(id), id).toBe(true)
  })
  it('안전하게 답하면 즉시 수임, 세금 체납이면 수임 불가', () => {
    expect(buildReport(items, diag('policy-fund', base), client).verdict.level).toBe('immediate')
    expect(buildReport(items, diag('policy-fund', { ...base, 'FUND-001': '아니오' }), client).verdict.level).toBe('blocked')
  })
  it('간단진단 보고서는 간단 문항만 집계한다', () => {
    const r = buildReport(items, diag('policy-fund', base), client)
    expect(r.applicable.every((i) => i.quick)).toBe(true)
    expect(r.applicable.length).toBeLessThanOrEqual(d.quickCount)
  })
})

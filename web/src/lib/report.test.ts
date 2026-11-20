import { describe, expect, it } from 'vitest'
import { getDomain } from './checklists'
import { buildReport } from './report'
import { firstWhere, safeAnswers } from './testutil'
import { EMPTY_PROFILE } from '../components/ClientForm'
import type { Answer, Client, Diagnosis } from './types'

const domain = getDomain('policy-fund')!
const client: Client = { id: 'c1', name: '테스트', profile: { ...EMPTY_PROFILE }, createdAt: '2026-01-01T00:00:00Z' }
const diag = (answers: Record<string, Answer>): Diagnosis => ({
  id: 'd1', clientId: 'c1', domain: 'policy-fund', answers, notes: {}, status: 'in_progress', createdAt: '', updatedAt: '',
})

describe('체크리스트 데이터 계약', () => {
  it('위험 규칙이 있는 모든 문항은 "해당"과 "비해당" 답이 모두 가능하다', () => {
    for (const it of domain.items) {
      if (it.risk_rule.trim() === 'False') continue
      expect(firstWhere(it, true), `${it.id} 위험 답 없음`).not.toBeUndefined()
      expect(firstWhere(it, false), `${it.id} 안전 답 없음`).not.toBeUndefined()
    }
  })
})

describe('buildReport 판정', () => {
  const safe = { ...safeAnswers(domain.items), 'FUND-017': 3, 'FUND-023': '증가', 'FUND-042': '예', 'FUND-034': '예' }

  it('응답이 60% 미만이면 판정 보류', () => {
    const r = buildReport(domain.items, diag({ 'FUND-001': '예' }), client)
    expect(r.verdict.level).toBe('incomplete')
  })
  it('모두 안전하면 즉시 수임, 빨강 0', () => {
    const r = buildReport(domain.items, diag(safe), client)
    expect(r.reds).toHaveLength(0)
    expect(r.verdict.level).toBe('immediate')
    expect(r.riskIndex).toBe(0)
  })
  it('세금 체납이면 수임 불가', () => {
    const r = buildReport(domain.items, diag({ ...safe, 'FUND-001': '아니오' }), client)
    expect(r.verdict.level).toBe('blocked')
  })
  it('결격 중 수임불가 목록이 아닌 빨강은 신청 보류', () => {
    const r = buildReport(domain.items, diag({ ...safe, 'FUND-003': '예' }), client)
    expect(r.verdict.level).toBe('hold')
  })
  it('빨강은 없고 인증이 없으면 준비 후 수임', () => {
    const r = buildReport(domain.items, diag({ ...safe, 'FUND-033': '없음', 'FUND-034': '아니오', 'FUND-035': '없음' }), client)
    expect(r.verdict.level).toBe('prepare')
  })
  it('조건부 문항은 고객사 정보에 따라 제외된다', () => {
    const r = buildReport(domain.items, diag(safe), client)
    const ids = r.applicable.map((i) => i.id)
    expect(ids).not.toContain('FUND-064') // 업력 7년 이상 + 복식부기만
    expect(ids).not.toContain('FUND-076') // 연구소 보유만
    const old = { ...client, profile: { ...client.profile, business_age: 9, has_research_lab: true } }
    const r2 = buildReport(domain.items, diag(safe), old)
    expect(r2.applicable.map((i) => i.id)).toEqual(expect.arrayContaining(['FUND-064', 'FUND-076']))
  })
  it('가점 문항은 해당돼도 결격·감점으로 집계되지 않는다', () => {
    const r = buildReport(domain.items, diag({ ...safe, 'FUND-036': 0 }), client)
    expect(r.blues.map((f) => f.item.id)).toContain('FUND-036')
    expect(r.reds.length + r.yellows.length).toBe(0)
  })
})

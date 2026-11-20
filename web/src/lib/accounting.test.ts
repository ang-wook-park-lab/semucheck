import { describe, expect, it } from 'vitest'
import { getDomain } from './checklists'
import { buildEnv, buildReport, isApplicable } from './report'
import { safeAnswers } from './testutil'
import { EMPTY_PROFILE } from '../components/ClientForm'
import type { Answer, ChecklistItem, Client, ClientProfile, Diagnosis } from './types'

const acc = getDomain('accounting')!
const mk = (p: Partial<ClientProfile> = {}): Client => ({ id: 'c', name: '회계테스트', profile: { ...EMPTY_PROFILE, ...p }, createdAt: '' })
const byQ = (text: string): ChecklistItem => {
  const it = acc.items.find((i) => i.question.includes(text))
  if (!it) throw new Error(`문항 없음: ${text}`)
  return it
}
const diag = (answers: Record<string, Answer>): Diagnosis => ({
  id: 'd', clientId: 'c', domain: 'accounting', answers, notes: {}, status: 'in_progress', createdAt: '', updatedAt: '',
})

describe('회계 체크리스트', () => {
  it('분야가 활성화되어 있고 9개 카테고리가 있다', () => {
    expect(acc.ready).toBe(true)
    const cats = new Set(acc.items.map((i) => i.category))
    for (const c of ['장부·증빙 관리', '부가가치세', '결산·재무제표', '재무 리스크·신용 연계', '법인세·세무조정', '원천세·급여·4대보험', '특수관계·자금 거래', '세무조사·절세 대비', '개인사업자 기본']) {
      expect(cats.has(c), c).toBe(true)
    }
  })
  it('문항 id는 ACC- 로 시작하고 중복이 없다', () => {
    expect(acc.items.every((i) => i.id.startsWith('ACC-'))).toBe(true)
    expect(new Set(acc.items.map((i) => i.id)).size).toBe(acc.items.length)
  })
  it('빨강(위반 위험) 문항에는 법령 근거가 있고, 불확실한 사항은 [실무자 확인 필요]로 표시된다', () => {
    for (const it of acc.items) {
      expect(it.recommendation, it.id).toBeTruthy()
      if (it.signal === 'red' && it.risk_rule !== 'False') expect(it.legal_basis, `${it.id} 법령 근거 없음`).toBeTruthy()
    }
    const flagged = acc.items.filter((i) => `${i.consequence}${i.legal_basis}${i.recommendation}`.includes('실무자 확인 필요'))
    expect(flagged.length).toBeGreaterThan(30)
  })

  it('법인 전용 문항은 개인사업자에게, 개인 전용 문항은 법인에게 나오지 않는다', () => {
    const corpOnly = byQ('법인세를 사업연도 종료일부터')
    const indvOnly = byQ('종합소득세를 매년 5월')
    const corp = buildEnv(mk({ business_type: '법인' }).profile, {})
    const indv = buildEnv(mk({ business_type: '개인' }).profile, {})
    expect(isApplicable(corpOnly, corp)).toBe(true)
    expect(isApplicable(corpOnly, indv)).toBe(false)
    expect(isApplicable(indvOnly, corp)).toBe(false)
    expect(isApplicable(indvOnly, indv)).toBe(true)
  })
  it('가지급금이 없다고 답하면 인정이자·정리 계획 문항이 사라진다', () => {
    const gate = byQ('재무제표에 가지급금 잔액이 있습니까')
    const interest = byQ('법정 인정이자')
    const env = (a?: Answer) => buildEnv(mk().profile, a === undefined ? {} : { [gate.id]: a })
    expect(isApplicable(interest, env())).toBe(true)
    expect(isApplicable(interest, env('아니오'))).toBe(false)
    expect(isApplicable(interest, env('예'))).toBe(true)
  })
  it('연구소 보유 고객사에만 연구개발비 세액공제 문항이 나온다', () => {
    const rnd = byQ('연구개발비를 별도 계정')
    expect(isApplicable(rnd, buildEnv(mk({ has_research_lab: false }).profile, {}))).toBe(false)
    expect(isApplicable(rnd, buildEnv(mk({ has_research_lab: true }).profile, {}))).toBe(true)
  })
  it('업무용 승용차가 없다고 답하면 운행기록부 문항이 사라진다', () => {
    const gate = byQ('업무용 승용차를 보유')
    const car = byQ('운행기록부를 작성')
    expect(isApplicable(car, buildEnv(mk().profile, { [gate.id]: '아니오' }))).toBe(false)
    expect(isApplicable(car, buildEnv(mk().profile, { [gate.id]: '예' }))).toBe(true)
  })
  it('가지급금 인정이자를 계산하지 않으면 빨강, 가지급금 자체는 노랑', () => {
    const gate = byQ('재무제표에 가지급금 잔액이 있습니까')
    const interest = byQ('법정 인정이자')
    const a = { ...safeAnswers(acc.items), [gate.id]: '예', [interest.id]: '아니오' }
    const r = buildReport(acc.items, diag(a), mk())
    expect(r.reds.map((f) => f.item.id)).toContain(interest.id)
    expect(r.yellows.map((f) => f.item.id)).toContain(gate.id)
  })
  it('부가세·원천세 신고 기한을 어기면 빨강이고 판정은 즉시 조치 필요', () => {
    const vat = byQ('부가가치세를 예정·확정 신고 기한')
    const r = buildReport(acc.items, diag({ ...safeAnswers(acc.items), [vat.id]: '아니오' }), mk())
    expect(r.reds.map((f) => f.item.id)).toContain(vat.id)
    expect(r.verdict.level).toBe('urgent')
  })
  it('모두 안전하게 답하면 양호', () => {
    const r = buildReport(acc.items, diag(safeAnswers(acc.items)), mk())
    expect(r.reds).toHaveLength(0)
    expect(r.yellows).toHaveLength(0)
    expect(r.verdict.level).toBe('good')
  })
  it('회계 분야 용어는 위반 위험·보완 필요·모범 사례', () => {
    expect(acc.labels.red).toBe('위반 위험')
  })
})

import { describe, expect, it } from 'vitest'
import { domains, getDomain } from './checklists'
import { buildReport, isApplicable, buildEnv } from './report'
import { firstWhere, safeAnswers } from './testutil'
import { EMPTY_PROFILE } from '../components/ClientForm'
import type { Answer, ChecklistItem, Client, Diagnosis } from './types'

const labor = getDomain('labor')!
const mk = (employees: number): Client => ({ id: 'c', name: '노무테스트', profile: { ...EMPTY_PROFILE, employees }, createdAt: '' })
const byQ = (text: string): ChecklistItem => {
  const it = labor.items.find((i) => i.question.includes(text))
  if (!it) throw new Error(`문항 없음: ${text}`)
  return it
}
const diag = (answers: Record<string, Answer>): Diagnosis => ({
  id: 'd', clientId: 'c', domain: 'labor', answers, notes: {}, status: 'in_progress', createdAt: '', updatedAt: '',
})

describe('위험 규칙 분야 공통 데이터 계약', () => {
  for (const d of domains.filter((x) => x.kind === 'risk' && x.ready)) {
    it(`${d.label}: 위험 규칙이 있는 모든 문항은 해당·비해당 답이 모두 가능하다`, () => {
      for (const it of d.items) {
        if (it.risk_rule.trim() === 'False') continue
        expect(firstWhere(it, true), `${it.id} 위험 답 없음`).not.toBeUndefined()
        expect(firstWhere(it, false), `${it.id} 안전 답 없음`).not.toBeUndefined()
      }
    })
    it(`${d.label}: 조건식(applies_if)은 고객사 정보 또는 같은 분야의 문항 id만 참조한다`, () => {
      const known = new Set<string>([...Object.keys(EMPTY_PROFILE), ...d.items.map((i) => i.id)])
      const words = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'True', 'False'])
      for (const it of d.items) {
        if (!it.applies_if) continue
        const stripped = it.applies_if.replace(/'[^']*'|"[^"]*"/g, '')
        for (const w of stripped.match(/[A-Za-z_][A-Za-z0-9_-]*/g) ?? []) {
          if (!words.has(w)) expect(known.has(w), `${it.id}: 알 수 없는 변수 ${w}`).toBe(true)
        }
      }
    })
  }
})

describe('노무 체크리스트', () => {
  it('5개 지침 영역과 기본 노무 관리 카테고리가 모두 있다', () => {
    const cats = new Set(labor.items.map((i) => i.category))
    for (const c of ['기본 노무 관리', '취업규칙 개정·신고', '근태·연차 관리', '괴롭힘·성희롱 대응', '징계·해고·권고사직', 'HR 경영보고(KPI)']) expect(cats.has(c), c).toBe(true)
  })
  it('문항 id는 LAB- 로 시작하고 중복이 없다', () => {
    expect(labor.items.every((i) => i.id.startsWith('LAB-'))).toBe(true)
    expect(new Set(labor.items.map((i) => i.id)).size).toBe(labor.items.length)
  })
  it('모든 문항에 권고가 있고, 법 위반 위험(빨강) 문항에는 근거 또는 확인 필요 표시가 있다', () => {
    for (const it of labor.items) {
      expect(it.recommendation, it.id).toBeTruthy()
      if (it.signal === 'red' && it.risk_rule !== 'False') {
        expect(Boolean(it.legal_basis) || it.consequence?.includes('실무자 확인 필요') || it.recommendation.includes('노무사'), `${it.id} 근거 없음`).toBe(true)
      }
    }
  })
  it('불확실한 법적 사항은 [실무자 확인 필요] 표시가 있다', () => {
    const flagged = labor.items.filter((i) => `${i.consequence}${i.legal_basis}${i.recommendation}`.includes('실무자 확인 필요'))
    expect(flagged.length).toBeGreaterThan(20)
  })

  it('상시 5인 미만이면 52시간·연차 문항이 제외되고, 5인 이상이면 포함된다', () => {
    const over52 = byQ('1주 52시간')
    const annual = byQ('법정 연차')
    const small = buildEnv(mk(4).profile, {})
    const big = buildEnv(mk(80).profile, {})
    expect(isApplicable(over52, small)).toBe(false)
    expect(isApplicable(annual, small)).toBe(false)
    expect(isApplicable(over52, big)).toBe(true)
  })
  it('상시 10명 미만이면 취업규칙 신고 문항이 제외된다', () => {
    const filed = byQ('취업규칙을 작성해 고용노동부')
    expect(isApplicable(filed, buildEnv(mk(9).profile, {}))).toBe(false)
    expect(isApplicable(filed, buildEnv(mk(10).profile, {}))).toBe(true)
  })
  it('취업규칙 개정 없음으로 답하면 개정 절차 문항이 사라진다', () => {
    const gate = byQ('개정안의 성격')
    const method = byQ('개정 절차는 개정의 성격에 맞게')
    const env = (a: Answer | undefined) => buildEnv(mk(80).profile, a === undefined ? {} : { [gate.id]: a })
    expect(isApplicable(method, env(undefined))).toBe(true) // 아직 모르면 일단 묻는다
    expect(isApplicable(method, env(gate.options![0]))).toBe(false)
    expect(isApplicable(method, env(gate.options![2]))).toBe(true)
  })
  it('불리한 변경인데 의견 청취만 받으면 빨강으로 집계된다', () => {
    const gate = byQ('개정안의 성격')
    const method = byQ('개정 절차는 개정의 성격에 맞게')
    const a = { ...safeAnswers(labor.items), [gate.id]: gate.options![2], [method.id]: '불리한 변경인데 의견 청취만 받음' }
    const r = buildReport(labor.items, diag(a), mk(80))
    expect(r.reds.map((f) => f.item.id)).toContain(method.id)
    expect(r.verdict.level).toBe('urgent')
  })
  it('서면 없는 연차 촉진(구두·메신저)은 노랑, 서면 촉진 시한 문항은 서면 이행일 때만 나온다', () => {
    const m = byQ('연차 사용 촉진은 어떻게')
    const timing = byQ('1차 촉구')
    const base = safeAnswers(labor.items)
    const verbal = buildReport(labor.items, diag({ ...base, [m.id]: '구두·메신저로만 촉진함' }), mk(80))
    expect(verbal.yellows.map((f) => f.item.id)).toContain(m.id)
    expect(verbal.applicable.map((i) => i.id)).not.toContain(timing.id)
    const written = buildReport(labor.items, diag({ ...base, [m.id]: '서면으로 단계별 촉진을 이행함' }), mk(80))
    expect(written.applicable.map((i) => i.id)).toContain(timing.id)
  })
  it('해고 검토 대상이 없으면 해고 절차 문항이 제외되고, 있으면 서면 통지 누락이 빨강이 된다', () => {
    const gate = byQ('징계·해고·권고사직을 진행 중이거나')
    const written = byQ('해고사유와 해고시기를 서면')
    const base = safeAnswers(labor.items)
    const none = buildReport(labor.items, diag({ ...base, [gate.id]: '아니오' }), mk(80))
    expect(none.applicable.map((i) => i.id)).not.toContain(written.id)
    const some = buildReport(labor.items, diag({ ...base, [gate.id]: '예', [written.id]: '아니오' }), mk(80))
    expect(some.reds.map((f) => f.item.id)).toContain(written.id)
  })
  it('모두 안전하게 답하면 양호', () => {
    const r = buildReport(labor.items, diag(safeAnswers(labor.items)), mk(80))
    expect(r.reds).toHaveLength(0)
    expect(r.yellows).toHaveLength(0)
    expect(r.verdict.level).toBe('good')
  })
  it('노무 분야 용어는 위반 위험·보완 필요·모범 사례', () => {
    expect(labor.labels.red).toBe('위반 위험')
    expect(getDomain('policy-fund')!.labels.red).toBe('결격')
  })
})

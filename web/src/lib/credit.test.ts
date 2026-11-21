import { describe, expect, it } from 'vitest'
import readXlsxFile from 'read-excel-file/universal'
import { getDomain, itemsForMode } from './checklists'
import { computeRatios, decideCreditVerdict, evaluateCredit, groupOfCategory, improvementTargets, ratioFindings, readInputs } from './credit'
import { exportRiskReportXlsx } from './excel'
import { buildReport } from './report'
import type { Answer, Client, Diagnosis } from './types'

const domain = getDomain('credit')!
const items = domain.items

/** 건강한 기업(백만원) */
const healthy = (over: Record<string, Answer> = {}): Record<string, Answer> => ({
  'CRD-010': 10000, 'CRD-011': 8000, 'CRD-012': 1000, 'CRD-013': 700, 'CRD-014': 100, 'CRD-015': 800,
  'CRD-016': 6000, 'CRD-017': 2400, 'CRD-018': 3600, 'CRD-019': 1000, 'CRD-020': 3000, 'CRD-021': 1500,
  'CRD-022': 1200, 'CRD-023': 600, 'CRD-024': 1200, 'CRD-025': 0, 'CRD-026': 0, 'CRD-027': 0,
  ...over,
})
/** 위기 기업: 매출 감소, 영업적자, 이자보상배율 1 미만, 완전자본잠식, 가지급금·가수금 */
const distressed = (over: Record<string, Answer> = {}): Record<string, Answer> => ({
  'CRD-010': 5000, 'CRD-011': 8000, 'CRD-012': -200, 'CRD-013': 300, 'CRD-014': 300, 'CRD-015': -600,
  'CRD-016': 4000, 'CRD-017': 6000, 'CRD-018': -2000, 'CRD-019': 500, 'CRD-020': 800, 'CRD-021': 2400,
  'CRD-022': 1800, 'CRD-023': 1500, 'CRD-024': 3000, 'CRD-025': 800, 'CRD-026': 400, 'CRD-027': 0,
  ...over,
})
const by = (a: Record<string, Answer>, key: string) => computeRatios(readInputs(a)).find((r) => r.key === key)!

describe('신용등급 체크리스트 데이터', () => {
  it('분야가 등록되어 사용할 수 있다', () => {
    expect(domain).toBeTruthy()
    expect(domain.ready).toBe(true)
    expect(domain.label).toBe('신용등급')
    expect(domain.count).toBeGreaterThanOrEqual(50)
  })
  it('문항 id 는 CRD- 로 시작하고 중복이 없다', () => {
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^CRD-\d{3}$/.test(id))).toBe(true)
  })
  it('재무 자료 입력 문항(CRD-010~027)은 숫자 입력이고 위험 판정 없이 분석에만 쓰인다', () => {
    for (let n = 10; n <= 27; n++) {
      const it = items.find((i) => i.id === `CRD-0${n}`)!
      expect(it, `CRD-0${n}`).toBeTruthy()
      expect(it.answer_type).toBe('number')
      expect(it.risk_rule).toBe('False')
    }
  })
  it('빨강(즉시 위험) 문항에는 근거·불이익이 있고 모든 문항에 권고가 있다', () => {
    for (const i of items) expect(i.recommendation.length, i.id).toBeGreaterThan(5)
    for (const i of items.filter((x) => x.signal === 'red')) expect(Boolean(i.consequence), i.id).toBe(true)
  })
  it('간단진단에는 재무 분석에 필요한 핵심 입력이 들어 있고 전체의 절반 이하다', () => {
    const quick = new Set(itemsForMode(domain, 'quick').map((i) => i.id))
    for (const id of ['CRD-010', 'CRD-011', 'CRD-012', 'CRD-014', 'CRD-016', 'CRD-017', 'CRD-018', 'CRD-019', 'CRD-024', 'CRD-025', 'CRD-026']) expect(quick.has(id), id).toBe(true)
    expect(domain.quickCount / domain.count).toBeLessThanOrEqual(0.5)
  })
  it('카테고리가 재무·비재무·기술 3요소로 나뉜다', () => {
    expect(groupOfCategory('C. 결산·세무 일관성')).toBe('financial')
    expect(groupOfCategory('D. 비재무 · 대표자')).toBe('nonfinancial')
    expect(groupOfCategory('E. 비재무 · 사업·거래')).toBe('nonfinancial')
    expect(groupOfCategory('G. 신용 이력·금융 관리')).toBe('nonfinancial')
    expect(groupOfCategory('F. 기술 · 인증')).toBe('tech')
    expect(groupOfCategory('A. 등급 현황')).toBeNull()
    expect(groupOfCategory('B. 재무 자료 입력 (최근 결산, 백만원)')).toBeNull()
    for (const c of new Set(items.map((i) => i.category))) expect(['financial', 'nonfinancial', 'tech', null]).toContain(groupOfCategory(c))
  })
})

describe('재무비율 계산(책 70장 기준)', () => {
  it('건강한 기업의 비율 값', () => {
    const a = healthy()
    expect(by(a, 'salesGrowth').value).toBeCloseTo(25, 5)
    expect(by(a, 'opMargin').value).toBeCloseTo(10, 5)
    expect(by(a, 'icr').value).toBeCloseTo(10, 5)
    expect(by(a, 'debtRatio').value).toBeCloseTo(66.667, 2)
    expect(by(a, 'equityRatio').value).toBeCloseTo(60, 5)
    expect(by(a, 'currentRatio').value).toBeCloseTo(200, 5)
    expect(by(a, 'borrowDep').value).toBeCloseTo(20, 5)
    expect(by(a, 'arDays').value).toBeCloseTo(43.8, 1)
    expect(computeRatios(readInputs(a)).every((r) => r.status === 'good')).toBe(true)
  })
  it('기준선: 이자보상배율 3배·1배, 부채비율 200%·400%, 유동비율 100%·150%, 차입금의존도 30%·50%', () => {
    expect(by(healthy({ 'CRD-012': 300, 'CRD-014': 100 }), 'icr').status).toBe('good') // 3배
    expect(by(healthy({ 'CRD-012': 299, 'CRD-014': 100 }), 'icr').status).toBe('watch')
    expect(by(healthy({ 'CRD-012': 99, 'CRD-014': 100 }), 'icr').status).toBe('bad')
    expect(by(healthy({ 'CRD-017': 7200 }), 'debtRatio').status).toBe('good') // 200%
    expect(by(healthy({ 'CRD-017': 7300 }), 'debtRatio').status).toBe('watch')
    expect(by(healthy({ 'CRD-017': 14500 }), 'debtRatio').status).toBe('bad') // 403%
    expect(by(healthy({ 'CRD-020': 2250 }), 'currentRatio').status).toBe('good') // 150%
    expect(by(healthy({ 'CRD-020': 2000 }), 'currentRatio').status).toBe('watch')
    expect(by(healthy({ 'CRD-020': 1400 }), 'currentRatio').status).toBe('bad')
    expect(by(healthy({ 'CRD-024': 1800 }), 'borrowDep').status).toBe('good') // 30%
    expect(by(healthy({ 'CRD-024': 2000 }), 'borrowDep').status).toBe('watch')
    expect(by(healthy({ 'CRD-024': 3100 }), 'borrowDep').status).toBe('bad')
  })
  it('영업이익률이 전년보다 2%p 이상 하락하면 주의', () => {
    expect(by(healthy({ 'CRD-012': 600, 'CRD-013': 700 }), 'opMargin').status).toBe('watch') // 6% vs 8.75%
    expect(by(healthy({ 'CRD-012': 800, 'CRD-013': 700 }), 'opMargin').status).toBe('good')
  })
  it('이자비용이 없으면 이자보상배율은 양호, 영업적자면 영업이익률 위험', () => {
    expect(by(healthy({ 'CRD-014': 0 }), 'icr').status).toBe('good')
    expect(by(healthy({ 'CRD-012': -50 }), 'opMargin').status).toBe('bad')
    expect(by(healthy({ 'CRD-012': -50 }), 'opLoss').status).toBe('bad')
  })
  it('자본잠식: 자기자본이 납입자본금보다 작으면 부분잠식, 0 이하면 완전잠식', () => {
    expect(by(healthy({ 'CRD-018': 800, 'CRD-019': 1000 }), 'impair').display).toBe('부분자본잠식')
    expect(by(healthy({ 'CRD-018': -10 }), 'impair').display).toBe('완전자본잠식')
    expect(by(healthy({ 'CRD-018': -10 }), 'debtRatio').status).toBe('bad')
    expect(by(healthy(), 'impair').display).toBe('없음')
  })
  it('가지급금·가수금이 있으면 위험·주의, 없으면 양호', () => {
    expect(by(healthy({ 'CRD-025': 100 }), 'suspense').status).toBe('bad')
    expect(by(healthy({ 'CRD-026': 100 }), 'deposit').status).toBe('watch')
    expect(by(healthy({ 'CRD-027': 1000 }), 'devCost').status).toBe('good') // 자기자본의 28%
    expect(by(healthy({ 'CRD-027': 1200 }), 'devCost').status).toBe('watch') // 33%
  })
  it('입력이 없는 지표는 계산하지 않는다', () => {
    const rows = computeRatios(readInputs({}))
    expect(rows.every((r) => r.status === 'na')).toBe(true)
    expect(computeRatios(readInputs({ 'CRD-010': 100, 'CRD-011': 0 })).find((r) => r.key === 'salesGrowth')!.status).toBe('na') // 전기 0으로 나누지 않는다
  })
})

describe('개선 과제(우선순위·로드맵에 합쳐질 항목)', () => {
  const sig = (a: Record<string, Answer>) => ratioFindings(a).map((f) => `${f.item.signal}:${f.item.question.slice(0, 12)}`)
  it('건강한 기업은 개선 과제가 없다', () => {
    expect(ratioFindings(healthy())).toHaveLength(0)
  })
  it('위기 기업: 가지급금·자본잠식·이자보상배율·매출 30% 감소가 즉시 위험(빨강), 가수금 등은 노랑', () => {
    const f = ratioFindings(distressed())
    const reds = f.filter((x) => x.item.signal === 'red').map((x) => x.item.question)
    expect(reds.some((q) => q.includes('가지급금'))).toBe(true)
    expect(reds.some((q) => q.includes('자본잠식'))).toBe(true)
    expect(reds.some((q) => q.includes('이자보상배율'))).toBe(true)
    expect(reds.some((q) => q.includes('매출이 30%'))).toBe(true)
    const yellows = f.filter((x) => x.item.signal === 'yellow').map((x) => x.item.question)
    expect(yellows.some((q) => q.includes('가수금'))).toBe(true)
    expect(yellows.some((q) => q.includes('영업이익이 적자'))).toBe(true)
    expect(f.every((x) => x.item.recommendation.length > 10 && x.item.id.startsWith('CRD-R'))).toBe(true)
  })
  it('부채비율은 200% 초과 노랑, 400% 초과 빨강', () => {
    expect(sig(healthy({ 'CRD-017': 8000 })).join()).toContain('yellow:부채비율이 200%')
    expect(sig(healthy({ 'CRD-017': 15000 })).join()).toContain('red:부채비율이 400%')
  })
  it('가지급금만 있어도 즉시 정리 대상(빨강)', () => {
    expect(sig(healthy({ 'CRD-025': 50 }))).toEqual(['red:가지급금이 있습니다 ('])
  })
  it('매출이 줄기만 하면(−30% 미만) 노랑', () => {
    expect(sig(healthy({ 'CRD-010': 7000 })).join()).toContain('yellow:매출이 감소했습니다')
  })
})

describe('필요 개선액', () => {
  it('부채비율 200%: 증자액 또는 부채 상환액', () => {
    const t = improvementTargets(readInputs({ 'CRD-017': 3000, 'CRD-018': 1000 }))
    expect(t.find((x) => x.label.includes('부채비율'))!.text).toContain('500백만원') // 3000/2 − 1000
    expect(t.find((x) => x.label.includes('부채비율'))!.text).toContain('1,000백만원') // 3000 − 2×1000
  })
  it('이자보상배율 3배: 필요한 영업이익', () => {
    const t = improvementTargets(readInputs({ 'CRD-012': 100, 'CRD-014': 100 }))
    expect(t.find((x) => x.label.includes('이자보상'))!.text).toContain('200백만원') // 300 − 100
  })
  it('유동비율 150%·차입금의존도 30%·자기자본비율 40%·자본잠식 해소', () => {
    const t = improvementTargets(readInputs({ 'CRD-020': 1000, 'CRD-021': 1000, 'CRD-024': 2000, 'CRD-016': 4000, 'CRD-018': 800, 'CRD-019': 1000 }))
    expect(t.find((x) => x.label.includes('유동비율'))!.text).toContain('500백만원') // 1500 − 1000
    expect(t.find((x) => x.label.includes('차입금'))!.text).toContain('800백만원') // 2000 − 0.3×4000
    expect(t.find((x) => x.label.includes('자기자본비율'))!.text).toContain('1,333백만원') // (1600 − 800)/0.6
    expect(t.find((x) => x.label.includes('자본잠식'))!.text).toContain('200백만원') // 1000 − 800
  })
  it('문제가 없으면 필요 개선액도 없다', () => {
    expect(improvementTargets(readInputs(healthy()))).toHaveLength(0)
  })
})

describe('등급 준비도 점수와 판정', () => {
  const good = (): Record<string, Answer> => {
    // 비재무·기술·결산 문항에 모두 "문제 없음" 응답(해당 규칙이 걸리지 않는 값)
    const a: Record<string, Answer> = {}
    for (const it of items) {
      if (groupOfCategory(it.category) === null) continue
      const rule = it.risk_rule
      if (it.answer_type === 'yes_no') a[it.id] = rule.includes("'예'") ? '아니오' : '예'
      else if (it.answer_type === 'number') a[it.id] = rule.includes('== 0') ? 3 : 1
      else if (it.answer_type === 'single_choice' && it.options) a[it.id] = it.options.find((o) => !rule.includes(o)) ?? it.options[0]
    }
    return a
  }
  it('건강한 기업은 우량권(80점 이상)이고 판정은 양호', () => {
    const r = evaluateCredit({ ...healthy(), ...good() }, items)
    expect(r.scores.financial).toBe(100)
    expect(r.scores.nonfinancial).toBe(100)
    expect(r.scores.total).toBeGreaterThanOrEqual(95)
    expect(r.band.key).toBe('high')
    expect(decideCreditVerdict(r).level).toBe('good')
  })
  it('위기 기업은 취약권이고 판정은 즉시 개선 필요', () => {
    const r = evaluateCredit(distressed(), items)
    expect(r.scores.total!).toBeLessThan(45)
    expect(r.band.key).toBe('weak')
    expect(decideCreditVerdict(r).level).toBe('urgent')
  })
  it('비재무 위험(대표자 연체)이 있으면 비재무 점수가 내려간다', () => {
    const base = evaluateCredit({ ...healthy(), ...good() }, items)
    const bad = evaluateCredit({ ...healthy(), ...good(), 'CRD-040': '예' }, items)
    expect(bad.scores.nonfinancial!).toBeLessThan(base.scores.nonfinancial!)
    expect(bad.scores.total!).toBeLessThan(base.scores.total!)
  })
  it('기술·인증이 없으면(가점 기회) 기술 점수가 내려간다', () => {
    const none = evaluateCredit({ ...healthy(), ...good(), 'CRD-060': '아니오', 'CRD-061': 0, 'CRD-062': '아니오', 'CRD-063': '아니오', 'CRD-064': '아니오', 'CRD-065': '아니오' }, items)
    const all = evaluateCredit({ ...healthy(), ...good(), 'CRD-060': '예', 'CRD-061': 3, 'CRD-062': '예', 'CRD-063': '예', 'CRD-064': '예', 'CRD-065': '예' }, items)
    expect(all.scores.tech).toBe(100)
    expect(none.scores.tech!).toBeLessThan(100)
  })
  it('재무가 나쁘면 비재무가 좋아도 비중(70%)에 따라 점수가 낮다', () => {
    const r = evaluateCredit({ ...distressed({ 'CRD-012': 100, 'CRD-014': 100, 'CRD-010': 7000 }), ...good() }, items)
    expect(r.scores.nonfinancial).toBe(100)
    expect(r.scores.total!).toBeLessThan(80)
  })
  it('즉시 위험 신호(자본잠식·이자보상배율 1배 미만·매출 30% 감소)가 있으면 점수에 상한이 걸린다', () => {
    // 위험 신호가 3개 겹친 기업은 비재무·기술이 완벽해도 44점 이하(취약)
    const r = evaluateCredit({ ...distressed(), ...good() }, items)
    expect(r.scores.nonfinancial).toBe(100)
    expect(r.scores.total!).toBeLessThanOrEqual(44)
    expect(r.band.key).toBe('weak')
    expect(r.capNote).toContain('자본잠식')
    expect(r.capNote).toContain('상한')
    // 신호가 1개뿐이면 59점 상한(보통권 미만)
    const one = evaluateCredit({ ...healthy({ 'CRD-018': 800, 'CRD-019': 1000 }), ...good() }, items) // 부분자본잠식만
    expect(one.scores.total!).toBeLessThanOrEqual(59)
    expect(one.band.key).toBe('low')
    // 신호가 없으면 상한 없음
    expect(evaluateCredit({ ...healthy(), ...good() }, items).capNote).toBeNull()
  })
  it('재무 자료가 부족하면 판정 보류', () => {
    const r = evaluateCredit({ 'CRD-010': 100, 'CRD-011': 90 }, items)
    expect(r.band.key).toBe('unknown')
    expect(decideCreditVerdict(r).level).toBe('incomplete')
    expect(evaluateCredit({}, items).scores.total).toBeNull()
  })
  it('현재·목표 등급을 입력하면 목표 안내가 나온다', () => {
    const r = evaluateCredit({ ...healthy(), 'CRD-001': 'BB(보통)', 'CRD-002': 'BBB 이상' }, items)
    expect(r.goalGap).toContain('BB(보통)')
    expect(r.goalGap).toContain('BBB 이상')
  })
})

describe('신용등급 보고서·엑셀', () => {
  const client: Client = {
    id: 'c1', name: '(주)신용시험', createdAt: '2026-01-01',
    profile: { business_type: '법인', business_age: 5, employees: 20, bookkeeping: '복식부기', has_research_lab: false, has_venture: false, planning_job_invention: false, industry: '제조업(C)' },
  }
  const diag = (answers: Record<string, Answer>, mode: 'full' | 'quick' = 'full'): Diagnosis => ({ id: 'd1', clientId: 'c1', domain: 'credit', answers, notes: {}, status: 'in_progress', mode, createdAt: '', updatedAt: '' })

  it('재무비율 개선 과제가 우선순위·로드맵·카테고리·지수에 합쳐진다', () => {
    const r = buildReport(items, diag({ ...distressed() }), client)
    expect(r.reds.some((f) => f.item.id.startsWith('CRD-R') && f.item.question.includes('가지급금'))).toBe(true)
    expect(r.priorities.length).toBeGreaterThan(0)
    expect(r.priorities[0].item.signal).toBe('red')
    expect(r.roadmap.now.some((f) => f.item.question.includes('자본잠식'))).toBe(true)
    expect(r.categories.some((c) => c.category === '재무비율 분석')).toBe(true)
    expect(r.riskIndex).toBeGreaterThan(50)
    expect(r.verdict.level).toBe('urgent')
  })
  it('건강한 기업 보고서는 양호이고 재무비율 과제가 없다', () => {
    const r = buildReport(items, diag({ ...healthy() }), client)
    expect(r.reds.filter((f) => f.item.id.startsWith('CRD-R'))).toHaveLength(0)
    expect(['good', 'fix']).toContain(r.verdict.level)
  })
  it('다른 분야 보고서에는 영향이 없다', () => {
    const labor = getDomain('labor')!
    const r = buildReport(labor.items, { ...diag({}), domain: 'labor' }, client)
    expect(r.categories.some((c) => c.category === '재무비율 분석')).toBe(false)
  })
  it('엑셀 보고서에 재무비율·필요 개선액 시트와 준비도가 들어간다', async () => {
    const d = diag(distressed())
    const r = buildReport(items, d, client)
    const blob = await exportRiskReportXlsx(domain, client, d, r)
    const sheets = (await readXlsxFile((await blob.arrayBuffer()) as never)) as unknown as { sheet: string; data: unknown[][] }[]
    expect(sheets.map((s) => s.sheet)).toEqual(['요약', '재무비율', '필요 개선액', '해당 항목', '미응답'])
    expect(sheets[0].data.some((row) => String(row[0]).includes('등급 준비도'))).toBe(true)
    const ratio = sheets[1].data
    expect(ratio.some((row) => row[1] === '부채비율')).toBe(true)
    expect(ratio.some((row) => row[1] === '가지급금' && row[4] === '위험')).toBe(true)
    expect(sheets[2].data.length).toBeGreaterThan(2)
  })
})

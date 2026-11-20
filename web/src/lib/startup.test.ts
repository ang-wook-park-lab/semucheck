import { describe, expect, it } from 'vitest'
import { getDomain, itemsForMode } from './checklists'
import { buildReport } from './report'
import { evaluateStartup, evaluateSupport, evaluateTax, youthOf, zoneOf } from './startup'
import type { Answer, Client, Diagnosis } from './types'
import { evalExpr } from './rules'

const CORP = '법인'
const INDIV = '개인사업자'
const STARTED = '시작함(사업자등록·법인설립 완료)'
const KEEP = '계속 운영 중(폐업 안 함)'
const CLOSE = '폐업했음(양도 없이 정리)'
const SELL = '타인에게 양도하고 폐업했음'
const CONV = '신규 법인에 현물출자·포괄양도했음(법인 전환)'

/** 모든 "문제 없음" 응답을 기본으로 깔고 시나리오별로 덮어쓴다 */
const base = (over: Record<string, Answer> = {}): Record<string, Answer> => ({
  'STUP-001': CORP, 'STUP-002': STARTED, 'STUP-003': 1, 'STUP-004': '2025년 12월 31일 이전',
  'STUP-010': 30, 'STUP-011': 0, 'STUP-012': '예',
  'STUP-020': '아니오', 'STUP-040': '아니오', 'STUP-041': '아니오', 'STUP-042': '아니오', 'STUP-043': '아니오', 'STUP-044': '아니오',
  'STUP-030': '아니오', 'STUP-034': '아니오',
  'STUP-050': '감면 대상 업종(제조업·건설업·정보통신업·전문과학기술서비스업·통신판매업·음식점업 등)',
  'STUP-060': '수도권 밖(비수도권)',
  ...over,
})

describe('창업진단 체크리스트 데이터', () => {
  const d = getDomain('startup')!
  it('분야가 등록되어 있고 사용할 수 있다', () => {
    expect(d).toBeTruthy()
    expect(d.ready).toBe(true)
    expect(d.label).toBe('창업')
    expect(d.count).toBeGreaterThanOrEqual(30)
  })
  it('문항 id 는 STUP- 로 시작하고 중복이 없다', () => {
    const ids = d.items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^STUP-\d{3}$/.test(id))).toBe(true)
  })
  it('모든 문항에 권고가 있고, 법령 근거가 필요한 판정 문항은 근거 또는 확인 필요 표시가 있다', () => {
    for (const i of d.items) expect(i.recommendation.length, i.id).toBeGreaterThan(5)
    const heavy = d.items.filter((i) => i.signal === 'red')
    for (const i of heavy) expect(Boolean(i.legal_basis), i.id).toBe(true)
  })
  it('조문 원문을 확인하지 못한 사항에는 [실무자 확인 필요] 표시가 있다', () => {
    const marked = d.items.filter((i) => `${i.recommendation}${i.help ?? ''}`.includes('[실무자 확인 필요'))
    expect(marked.length).toBeGreaterThanOrEqual(6)
  })
  it('판정 로직이 읽는 문항 id 가 모두 체크리스트에 있다', () => {
    const ids = new Set(d.items.map((i) => i.id))
    for (const id of ['STUP-001', 'STUP-002', 'STUP-003', 'STUP-004', 'STUP-010', 'STUP-011', 'STUP-012', 'STUP-020', 'STUP-021', 'STUP-022', 'STUP-023', 'STUP-024', 'STUP-025', 'STUP-026', 'STUP-027', 'STUP-028', 'STUP-029', 'STUP-030', 'STUP-031', 'STUP-032', 'STUP-033', 'STUP-034', 'STUP-040', 'STUP-041', 'STUP-042', 'STUP-043', 'STUP-044', 'STUP-050', 'STUP-060', 'STUP-061', 'STUP-070']) {
      expect(ids.has(id), id).toBe(true)
    }
  })
  it('선택지 문구가 판정 로직의 기대값과 일치한다(단일 선택 문항의 규칙이 선택지만 참조)', () => {
    const f = d.items.find((i) => i.id === 'STUP-021')!
    expect(f.options).toEqual([KEEP, CLOSE, SELL, CONV])
    const stage = d.items.find((i) => i.id === 'STUP-002')!
    expect(stage.options).toContain(STARTED)
  })
  it('간단진단에는 판정에 필요한 문항이 들어 있고 정밀 진단보다 적다', () => {
    expect(d.quickCount).toBeGreaterThanOrEqual(15)
    expect(d.quickCount).toBeLessThan(d.count)
    const quick = new Set(itemsForMode(d, 'quick').map((i) => i.id))
    for (const id of ['STUP-001', 'STUP-020', 'STUP-022', 'STUP-023', 'STUP-030', 'STUP-041', 'STUP-043', 'STUP-060']) expect(quick.has(id), id).toBe(true)
  })
})

describe('창업지원법(정책자금) 판정', () => {
  it('기존 개인사업이 없고 승계도 없으면 인정', () => {
    expect(evaluateSupport(base()).status).toBe('ok')
  })
  it('개인사업을 유지하면서 동종 법인을 신설: 지분 30% 이상이면 창업 아님, 30% 미만이고 최대주주 아니면 인정', () => {
    const keep = { 'STUP-020': '예', 'STUP-021': KEEP, 'STUP-022': '예' }
    expect(evaluateSupport(base({ ...keep, 'STUP-028': 40, 'STUP-029': '아니오' })).status).toBe('ng')
    expect(evaluateSupport(base({ ...keep, 'STUP-028': 10, 'STUP-029': '예' })).status).toBe('ng')
    const ok = evaluateSupport(base({ ...keep, 'STUP-028': 10, 'STUP-029': '아니오' }))
    expect(ok.status).toBe('ok')
    expect(ok.notes.join(' ')).toContain('30% 미만')
    expect(evaluateSupport(base(keep)).status).toBe('check') // 지분 미입력
  })
  it('개인사업이라도 이종 사업이면 창업 제외 사유가 아니다', () => {
    const r = evaluateSupport(base({ 'STUP-020': '예', 'STUP-021': KEEP, 'STUP-022': '아니오' }))
    expect(r.status).toBe('ok')
  })
  it('폐업 후 동종 재개: 3년 이내 불인정, 3년 이후 인정, 부도·파산은 2년', () => {
    const closed = { 'STUP-020': '예', 'STUP-021': CLOSE, 'STUP-022': '예' }
    expect(evaluateSupport(base({ ...closed, 'STUP-023': 12, 'STUP-024': '아니오' })).status).toBe('ng')
    expect(evaluateSupport(base({ ...closed, 'STUP-023': 35, 'STUP-024': '아니오' })).status).toBe('ng')
    expect(evaluateSupport(base({ ...closed, 'STUP-023': 36, 'STUP-024': '아니오' })).status).toBe('ok')
    expect(evaluateSupport(base({ ...closed, 'STUP-023': 30, 'STUP-024': '예' })).status).toBe('ok') // 부도·파산은 24개월
    expect(evaluateSupport(base({ ...closed, 'STUP-023': 20, 'STUP-024': '예' })).status).toBe('ng')
    expect(evaluateSupport(base({ ...closed, 'STUP-021': SELL, 'STUP-023': 6, 'STUP-024': '아니오' })).status).toBe('ng') // 양도 후 폐업도 같다
  })
  it('기존 법인의 과점주주가 신규 법인의 과점주주가 되면 불인정(2024.7.10. 개정)', () => {
    const sh = { 'STUP-030': '예', 'STUP-031': '예' }
    const r = evaluateSupport(base({ ...sh, 'STUP-032': 60, 'STUP-033': '예' }))
    expect(r.status).toBe('ng')
    expect(r.reasons.join(' ')).toContain('과점주주')
    expect(evaluateSupport(base({ ...sh, 'STUP-032': 60, 'STUP-033': '아니오' })).status).toBe('ok')
    expect(evaluateSupport(base({ ...sh, 'STUP-032': 40, 'STUP-033': '예' })).status).toBe('ok') // 50% 이하는 과점주주 아님
    expect(evaluateSupport(base({ ...sh })).status).toBe('check')
    expect(evaluateSupport(base({ 'STUP-030': '예', 'STUP-031': '아니오' })).status).toBe('ok') // 이종이면 무관
  })
  it('자회사·조직변경·상속증여는 불인정', () => {
    expect(evaluateSupport(base({ 'STUP-034': '예' })).status).toBe('ng')
    expect(evaluateSupport(base({ 'STUP-044': '예' })).status).toBe('ng')
    expect(evaluateSupport(base({ 'STUP-040': '예' })).status).toBe('ng')
  })
  it('창업 후 7년이 지나면 창업기업이 아니다', () => {
    expect(evaluateSupport(base({ 'STUP-003': 7 })).status).toBe('ng')
    expect(evaluateSupport(base({ 'STUP-003': 6.9 })).status).toBe('ok')
  })
  it('개인 → 법인 전환은 업력 승계 안내가 나온다', () => {
    const r = evaluateSupport(base({ 'STUP-020': '예', 'STUP-021': CONV, 'STUP-022': '예' }))
    expect(r.notes.join(' ')).toContain('개인 개업일부터 기산')
  })
  it('필수 문항이 비어 있으면 판정 보류', () => {
    expect(evaluateSupport({}).status).toBe('pending')
    expect(evaluateSupport({ 'STUP-001': CORP, 'STUP-020': '아니오' }).status).toBe('pending')
  })
})

describe('세법(조세특례제한법 제6조) 판정', () => {
  it('처음 시작하는 사업은 인정', () => {
    expect(evaluateTax(base()).status).toBe('ok')
  })
  it('합병·분할·현물출자·사업양수로 승계하면 불인정', () => {
    expect(evaluateTax(base({ 'STUP-041': '예' })).status).toBe('ng')
  })
  it('개인 → 법인 전환: 사업용 자산 50% 이상 승계하면 불인정, 미만이면 확인', () => {
    const conv = { 'STUP-020': '예', 'STUP-021': CONV, 'STUP-022': '예' }
    expect(evaluateTax(base({ ...conv, 'STUP-027': 100 })).status).toBe('ng')
    expect(evaluateTax(base({ ...conv, 'STUP-027': 50 })).status).toBe('ng')
    expect(evaluateTax(base({ ...conv, 'STUP-027': 30 })).status).toBe('check')
    expect(evaluateTax(base(conv)).status).toBe('check')
  })
  it('폐업 후 동종 재개: 3년 이내는 불인정, 이후에도 실질 확인', () => {
    const closed = { 'STUP-020': '예', 'STUP-021': CLOSE, 'STUP-022': '예' }
    expect(evaluateTax(base({ ...closed, 'STUP-023': 12 })).status).toBe('ng')
    expect(evaluateTax(base({ ...closed, 'STUP-023': 60 })).status).toBe('check')
  })
  it('개인사업 유지 + 동종 신설: 같은 장소나 승계가 있으면 불인정, 장소가 다르고 승계가 없으면 확인(별개 사업 여지)', () => {
    const keep = { 'STUP-020': '예', 'STUP-021': KEEP, 'STUP-022': '예' }
    expect(evaluateTax(base({ ...keep, 'STUP-025': '같은 장소', 'STUP-026': '아니오' })).status).toBe('ng')
    expect(evaluateTax(base({ ...keep, 'STUP-025': '다른 장소', 'STUP-026': '예' })).status).toBe('ng')
    const diff = evaluateTax(base({ ...keep, 'STUP-025': '다른 장소', 'STUP-026': '아니오' }))
    expect(diff.status).toBe('ok')
    expect(diff.notes.join(' ')).toContain('별개의 신규 사업')
  })
  it('세법에는 기존 법인 과점주주 규정이 없다(지원법과 결과가 갈린다)', () => {
    const a = base({ 'STUP-030': '예', 'STUP-031': '예', 'STUP-032': 60, 'STUP-033': '예' })
    expect(evaluateSupport(a).status).toBe('ng')
    expect(evaluateTax(a).status).toBe('ok')
    const s = evaluateStartup(a)
    expect(s.differences.join(' ')).toContain('세법에는 없습니다')
    expect(s.overall.level).toBe('urgent')
    expect(s.overall.title).toContain('정책자금')
  })
  it('감면 제외 업종이면 창업은 인정돼도 확인 사항이 생긴다', () => {
    const r = evaluateTax(base({ 'STUP-050': '감면 제외 가능 업종(도소매업[통신판매 제외]·부동산업·임대업·소비성 서비스업 등)' }))
    expect(r.status).toBe('check')
    expect(r.reasons.join(' ')).toContain('감면 제외')
  })
})

describe('청년 여부', () => {
  it('만 15~34세는 청년, 군 복무는 최대 6년까지 제외', () => {
    expect(youthOf(base({ 'STUP-010': 34 })).status).toBe('yes')
    expect(youthOf(base({ 'STUP-010': 35 })).status).toBe('no')
    expect(youthOf(base({ 'STUP-010': 36, 'STUP-011': 3 })).status).toBe('yes') // 33세
    expect(youthOf(base({ 'STUP-010': 41, 'STUP-011': 9 })).status).toBe('no') // 6년까지만 제외 → 35세
    expect(youthOf(base({ 'STUP-010': 41, 'STUP-011': 6 })).status).toBe('no')
    expect(youthOf(base({ 'STUP-010': 40, 'STUP-011': 6 })).status).toBe('yes') // 34세
    expect(youthOf(base({ 'STUP-010': 14 })).status).toBe('no')
    expect(youthOf({}).status).toBe('unknown')
  })
  it('법인은 대표자가 최대주주가 아니면 확인 필요', () => {
    expect(youthOf(base({ 'STUP-010': 30, 'STUP-012': '아니오' })).status).toBe('check')
    expect(youthOf(base({ 'STUP-001': INDIV, 'STUP-010': 30 })).status).toBe('yes')
  })
  it('청년 전용 정책자금은 만 39세 이하·업력 3년 미만', () => {
    expect(youthOf(base({ 'STUP-010': 38, 'STUP-003': 1 })).fundYouth).toBe(true)
    expect(youthOf(base({ 'STUP-010': 38, 'STUP-003': 4 })).fundYouth).toBe(false)
    expect(youthOf(base({ 'STUP-010': 40, 'STUP-003': 1 })).fundYouth).toBe(false)
  })
})

describe('수도권과밀억제권역', () => {
  it('소재지 선택지를 과밀억제권역·수도권(과밀 외)·수도권 밖으로 나눈다', () => {
    const z = (s: string) => zoneOf({ 'STUP-060': s }).zone
    expect(z('서울특별시')).toBe('over')
    expect(z('인천광역시 중 과밀억제권역 해당 지역')).toBe('over')
    expect(z('인천광역시 중 그 밖의 지역(강화·옹진·경제자유구역·남동국가산단 등)')).toBe('metro')
    expect(z('경기도 과밀억제권역(의정부·구리·하남·고양·수원·성남·안양·부천·광명·과천·의왕·군포·시흥 일부·남양주 일부)')).toBe('over')
    expect(z('경기도 그 밖의 지역(성장관리권역·자연보전권역 등)')).toBe('metro')
    expect(z('수도권 밖(비수도권)')).toBe('non')
    expect(zoneOf({}).zone).toBe('unknown')
  })
  it('문항의 모든 소재지 선택지가 판정 로직에서 인식된다', () => {
    const item = getDomain('startup')!.items.find((i) => i.id === 'STUP-060')!
    for (const o of item.options!) expect(zoneOf({ 'STUP-060': o }).zone, o).not.toBe('unknown')
  })
  it('감면율 참고: 창업 시기·청년·지역에 따라 안내가 달라지고 모두 확인 필요 표시가 있다', () => {
    const line = (over: Record<string, Answer>) => evaluateStartup(base(over)).benefit.join('\n')
    expect(line({ 'STUP-010': 30, 'STUP-060': '서울특별시' })).toContain('50%')
    expect(line({ 'STUP-010': 30, 'STUP-060': '수도권 밖(비수도권)' })).toContain('100%')
    expect(line({ 'STUP-010': 40, 'STUP-060': '서울특별시' })).toContain('감면 제외')
    expect(line({ 'STUP-004': '2026년 1월 1일 이후(또는 예정)', 'STUP-010': 30, 'STUP-060': '경기도 그 밖의 지역(성장관리권역·자연보전권역 등)' })).toContain('75%')
    expect(line({ 'STUP-004': '2026년 1월 1일 이후(또는 예정)', 'STUP-010': 30, 'STUP-060': '서울특별시' })).toContain('[확인 필요]')
  })
})

describe('창업진단 보고서', () => {
  const client: Client = {
    id: 'c1', name: '(주)창업시험', createdAt: '2026-01-01',
    profile: { business_type: '법인', business_age: 0, employees: 3, bookkeeping: '복식부기', has_research_lab: false, has_venture: false, planning_job_invention: false, industry: '제조업(C)' },
  }
  const diag = (answers: Record<string, Answer>): Diagnosis => ({ id: 'd1', clientId: 'c1', domain: 'startup', answers, notes: {}, status: 'in_progress', mode: 'full', createdAt: '', updatedAt: '' })
  const report = (answers: Record<string, Answer>) => buildReport(getDomain('startup')!.items, diag(answers), client)

  it('판정은 법령별 결과를 따른다(응답 진행률이 낮아도 판정 가능)', () => {
    const r = report({ 'STUP-001': CORP, 'STUP-020': '예', 'STUP-021': CLOSE, 'STUP-022': '예', 'STUP-023': 6, 'STUP-040': '아니오', 'STUP-041': '아니오', 'STUP-043': '아니오' })
    expect(r.verdict.level).toBe('urgent')
    expect(r.verdict.title).toContain('창업')
    expect(r.reds.map((f) => f.item.id)).toContain('STUP-023')
  })
  it('문제 없는 응답은 "창업으로 인정될 가능성이 높습니다"', () => {
    const r = report(base())
    expect(r.verdict.level).toBe('good')
    expect(r.reds).toHaveLength(0)
  })
  it('응답이 없으면 판정 보류', () => {
    expect(report({}).verdict.level).toBe('incomplete')
  })
  it('같은 문항이라도 해당하지 않는 후속 문항은 적용 조건으로 빠진다', () => {
    const applicable = (answers: Record<string, Answer>) => report(answers).applicable.map((i) => i.id)
    expect(applicable(base())).not.toContain('STUP-023')
    expect(applicable(base({ 'STUP-020': '예', 'STUP-021': CLOSE, 'STUP-022': '예' }))).toContain('STUP-023')
    expect(applicable(base({ 'STUP-020': '예', 'STUP-021': KEEP, 'STUP-022': '예' }))).not.toContain('STUP-023')
    expect(applicable(base({ 'STUP-001': INDIV }))).not.toContain('STUP-030')
    expect(applicable(base({ 'STUP-030': '예' }))).toContain('STUP-031')
  })
  it('빨강 문항의 규칙은 판정 로직과 같은 기준을 쓴다', () => {
    const rule = (id: string) => getDomain('startup')!.items.find((i) => i.id === id)!.risk_rule
    expect(evalExpr(rule('STUP-023'), { answer: 35 })).toBe(true)
    expect(evalExpr(rule('STUP-023'), { answer: 36 })).toBe(false)
    expect(evalExpr(rule('STUP-028'), { answer: 30 })).toBe(true)
    expect(evalExpr(rule('STUP-028'), { answer: 29 })).toBe(false)
    expect(evalExpr(rule('STUP-032'), { answer: 51 })).toBe(true)
    expect(evalExpr(rule('STUP-032'), { answer: 50 })).toBe(false)
    expect(evalExpr(rule('STUP-027'), { answer: 50 })).toBe(true)
  })
})

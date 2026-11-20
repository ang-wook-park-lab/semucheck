import { afterEach, describe, expect, it } from 'vitest'
import { applyOverrides, getBundled, getDomain, resetOverrides, allItems } from './checklists'
import { validateRiskItems, validateStatusList } from './checklistValidate'
import type { ChecklistItem, GmChecklist } from './types'

afterEach(() => resetOverrides())
const meta = { updatedAt: '2026-11-20T00:00:00Z', updatedBy: '관리자' }
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

describe('관리자 수정본 적용', () => {
  it('유효한 수정본은 원본 위에 적용되고, 되돌리면 원본으로 돌아간다', () => {
    const labor = getDomain('labor')!
    const original = labor.items[0].question
    const items = clone(getBundled('labor').items)
    items[0].question = '관리자가 고친 질문입니까?'
    const r = applyOverrides({ labor: { data: items, ...meta } })
    expect(r.applied).toEqual(['labor'])
    expect(labor.items[0].question).toBe('관리자가 고친 질문입니까?')
    expect(labor.override).toMatchObject({ updatedBy: '관리자' })
    expect(allItems.find((i) => i.id === items[0].id)!.question).toBe('관리자가 고친 질문입니까?')
    resetOverrides()
    expect(labor.items[0].question).toBe(original)
    expect(labor.override).toBeUndefined()
  })

  it('수정본이 없는 분야는 영향을 받지 않는다', () => {
    const before = getDomain('accounting')!.items
    applyOverrides({ labor: { data: clone(getBundled('labor').items), ...meta } })
    expect(getDomain('accounting')!.items).toBe(before)
  })

  it('규칙 문법 오류가 있는 수정본은 거부하고 원본을 쓴다(모두의 화면이 깨지지 않게)', () => {
    const labor = getDomain('labor')!
    const items = clone(getBundled('labor').items)
    items[0].risk_rule = 'answer =='
    const r = applyOverrides({ labor: { data: items, ...meta } })
    expect(r.applied).toEqual([])
    expect(r.rejected[0].domain).toBe('labor')
    expect(r.rejected[0].errors.join()).toContain('해석할 수 없습니다')
    expect(labor.items).toBe(getBundled('labor').items)
    expect(labor.override).toBeUndefined()
  })

  it('간단진단 표시를 바꾸면 문항 수가 반영된다', () => {
    const items = clone(getBundled('labor').items).map((i) => ({ ...i, quick: i.id === 'LAB-001' ? true : undefined })) as ChecklistItem[]
    applyOverrides({ labor: { data: items, ...meta } })
    expect(getDomain('labor')!.quickCount).toBe(1)
  })

  it('법인 일반관리(상태 점검표) 수정본도 적용된다', () => {
    const g = clone(getBundled('corporate-general').status!)
    g.areas[0].items[0].text = '관리자가 고친 점검 항목'
    applyOverrides({ 'corporate-general': { data: g, ...meta } })
    expect(getDomain('corporate-general')!.status!.areas[0].items[0].text).toBe('관리자가 고친 점검 항목')
    const bad = clone(g) as GmChecklist
    bad.areas[0].items[0].risk_level = 'extreme' as never
    const r = applyOverrides({ 'corporate-general': { data: bad, ...meta } })
    expect(r.rejected).toHaveLength(1)
    expect(getDomain('corporate-general')!.status!.areas[0].items[0].text).not.toBe('관리자가 고친 점검 항목')
  })

  it('알 수 없는 분야의 수정본은 무시한다', () => {
    expect(applyOverrides({ nothing: { data: [], ...meta } })).toEqual({ applied: [], rejected: [] })
  })
})

describe('체크리스트 검증기', () => {
  const ok = () => clone(getBundled('policy-fund').items)

  it('앱에 들어 있는 원본은 모두 통과한다', () => {
    for (const k of ['policy-fund', 'labor', 'accounting']) expect(validateRiskItems(k, getBundled(k).items), k).toEqual([])
    expect(validateStatusList('corporate-general', getBundled('corporate-general').status)).toEqual([])
  })
  it('빈 목록·중복 ID·잘못된 신호·응답유형', () => {
    expect(validateRiskItems('policy-fund', [])).not.toEqual([])
    const items = ok()
    items[1].id = items[0].id
    items[2].signal = 'purple' as never
    items[3].answer_type = 'text' as never
    const msg = validateRiskItems('policy-fund', items).join('\n')
    expect(msg).toContain('중복')
    expect(msg).toContain('신호는 red')
    expect(msg).toContain('응답유형')
  })
  it('선택지에 없는 값을 쓰는 규칙, 알 수 없는 조건 변수, 자기 참조', () => {
    const items = ok()
    const choice = items.find((i) => i.answer_type === 'single_choice')!
    choice.risk_rule = "answer in ['없는값']"
    items[0].applies_if = 'mystery == 1'
    items[1].applies_if = `${items[1].id} == '예'`
    const msg = validateRiskItems('policy-fund', items).join('\n')
    expect(msg).toContain('선택지에 없습니다')
    expect(msg).toContain('알 수 없는 변수')
    expect(msg).toContain('자기 자신')
  })
  it('다른 분야 domain 값, 잘못된 날짜 형식, 중요도 범위', () => {
    const items = ok()
    items[0].domain = 'labor'
    items[1].verified_at = '2026/11/20'
    items[2].score_weight = 500
    const msg = validateRiskItems('policy-fund', items).join('\n')
    expect(msg).toContain('domain')
    expect(msg).toContain('YYYY-MM-DD')
    expect(msg).toContain('중요도')
  })
  it('상태 점검표: 영역 없음·중복 항목 ID', () => {
    expect(validateStatusList('corporate-general', { areas: [] })).not.toEqual([])
    const g = clone(getBundled('corporate-general').status!)
    g.areas[1].items[0].id = g.areas[0].items[0].id
    expect(validateStatusList('corporate-general', g).join()).toContain('중복')
  })
})

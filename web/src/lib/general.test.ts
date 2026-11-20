import { describe, expect, it } from 'vitest'
import { getDomain } from './checklists'
import { buildGeneralReport, NOTE_SUMMARY } from './general'
import { EMPTY_PROFILE } from '../components/ClientForm'
import type { Client, Diagnosis, StatusCode } from './types'

const gm = getDomain('corporate-general')!.status!
const client: Client = { id: 'c1', name: '테스트', profile: { ...EMPTY_PROFILE }, createdAt: '2026-01-01T00:00:00Z' }
const allItems = gm.areas.flatMap((a) => a.items)
const diag = (answers: Record<string, StatusCode>, notes: Record<string, string> = {}): Diagnosis => ({
  id: 'd1', clientId: 'c1', domain: 'corporate-general', answers, notes, status: 'in_progress', createdAt: '', updatedAt: '',
})
const allOk = (): Record<string, StatusCode> => Object.fromEntries(allItems.map((i) => [i.id, 'ok' as StatusCode]))

describe('법인 일반관리 64항목 데이터', () => {
  it('8영역 × 8항목 = 64항목, id 중복 없음', () => {
    expect(gm.areas).toHaveLength(8)
    for (const a of gm.areas) expect(a.items, a.name).toHaveLength(8)
    expect(allItems).toHaveLength(64)
    expect(new Set(allItems.map((i) => i.id)).size).toBe(64)
  })
  it('모든 항목에 점검 항목·점검 포인트·권고·위험도가 있다', () => {
    for (const i of allItems) {
      expect(i.text, i.id).toBeTruthy()
      expect(i.check, i.id).toBeTruthy()
      expect(i.recommendation, i.id).toBeTruthy()
      expect(['high', 'medium', 'low'], i.id).toContain(i.risk_level)
    }
  })
  it('영역마다 핵심 포인트가 있고 영역 번호 순서가 01~08이다', () => {
    expect(gm.areas.map((a) => a.id)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08'])
    for (const a of gm.areas) expect(a.key_point, a.id).toBeTruthy()
  })
  it('상태 표시는 양호·보완필요·미흡·해당없음 4가지', () => {
    expect(gm.status_options.map((o) => o.code)).toEqual(['ok', 'fix', 'bad', 'na'])
  })
})

describe('buildGeneralReport', () => {
  it('점검이 60% 미만이면 판정 보류', () => {
    const r = buildGeneralReport(gm, diag({ [allItems[0].id]: 'ok' }), client)
    expect(r.verdict.level).toBe('incomplete')
    expect(r.unanswered).toHaveLength(63)
  })
  it('모두 양호하면 양호·관리 수준 100점', () => {
    const r = buildGeneralReport(gm, diag(allOk()), client)
    expect(r.verdict.level).toBe('good')
    expect(r.managementScore).toBe(100)
    expect(r.findings).toHaveLength(0)
  })
  it('위험도 높은 항목이 미흡이면 즉시 개선 필요', () => {
    const high = allItems.find((i) => i.risk_level === 'high')!
    const r = buildGeneralReport(gm, diag({ ...allOk(), [high.id]: 'bad' }), client)
    expect(r.verdict.level).toBe('urgent')
  })
  it('위험도 낮은 항목의 보완필요만 있으면 보완 필요', () => {
    const low = allItems.find((i) => i.risk_level === 'low')!
    const r = buildGeneralReport(gm, diag({ ...allOk(), [low.id]: 'fix' }), client)
    expect(r.verdict.level).toBe('fix')
  })
  it('해당없음은 점수 계산에서 빠지고 응답으로 센다', () => {
    const a = allOk()
    a[allItems[0].id] = 'na'
    const r = buildGeneralReport(gm, diag(a), client)
    expect(r.totals.na).toBe(1)
    expect(r.answeredCount).toBe(64)
    expect(r.managementScore).toBe(100)
  })
  it('관리 수준: 보완필요는 0.5점', () => {
    const a = allOk()
    for (const i of allItems.slice(0, 2)) a[i.id] = 'fix' // 62 ok + 2 fix → (62 + 1) / 64
    const r = buildGeneralReport(gm, diag(a), client)
    expect(r.managementScore).toBe(Math.round((63 / 64) * 100))
  })
  it('우선순위: 미흡이 보완필요보다, 같으면 위험도 높은 순', () => {
    const low = allItems.filter((i) => i.risk_level === 'low')
    const high = allItems.filter((i) => i.risk_level === 'high')
    const a = allOk()
    a[low[0].id] = 'bad'
    a[high[0].id] = 'fix'
    a[high[1].id] = 'bad'
    const r = buildGeneralReport(gm, diag(a), client)
    expect(r.priorities.map((f) => f.item.id)).toEqual([high[1].id, low[0].id, high[0].id])
    expect(r.priorities.map((f) => f.status)).toEqual(['bad', 'bad', 'fix'])
  })
  it('우선순위는 최대 5개', () => {
    const a = allOk()
    for (const i of allItems.slice(0, 9)) a[i.id] = 'bad'
    expect(buildGeneralReport(gm, diag(a), client).priorities).toHaveLength(5)
  })
  it('메모와 종합 코멘트가 보고서에 전달된다', () => {
    const id = allItems[0].id
    const r = buildGeneralReport(gm, diag({ ...allOk(), [id]: 'bad' }, { [id]: '정관 미비', [NOTE_SUMMARY]: '종합 의견' }), client)
    expect(r.findings[0].note).toBe('정관 미비')
    expect(r.summary).toBe('종합 의견')
  })
})

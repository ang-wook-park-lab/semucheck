import { describe, expect, it } from 'vitest'
import { evalExpr, isRisk } from './rules'
import { allItems } from './checklists'

describe('evalExpr', () => {
  it('비교·목록·논리 연산', () => {
    expect(evalExpr("answer == '아니오'", { answer: '아니오' })).toBe(true)
    expect(evalExpr('answer > 200', { answer: 250 })).toBe(true)
    expect(evalExpr('answer < 1', { answer: 1 })).toBe(false)
    expect(evalExpr("answer in ['a', 'b']", { answer: 'b' })).toBe(true)
    expect(evalExpr("a >= 7 and b == '복식부기'", { a: 8, b: '복식부기' })).toBe(true)
    expect(evalExpr("a >= 7 and b == '복식부기'", { a: 3, b: '복식부기' })).toBe(false)
    expect(evalExpr('x == true', { x: true })).toBe(true)
    expect(evalExpr("FUND-038 == '예' or p == true", { 'FUND-038': '아니오', p: true })).toBe(true)
  })
  it('값이 없으면 null(알 수 없음)', () => {
    expect(evalExpr("FUND-038 == '예'", {})).toBeNull()
    expect(evalExpr("FUND-038 == '예' or p == true", {})).toBeNull()
    expect(evalExpr("FUND-038 == '예' and p == true", { p: false })).toBe(false)
  })
  it('문법 오류는 예외', () => {
    expect(() => evalExpr('answer ==', { answer: 1 })).toThrow()
    expect(() => evalExpr("answer == 'x", { answer: 1 })).toThrow()
  })
  it("'False' 규칙은 정보 수집용", () => {
    expect(isRisk('False', 3)).toBe(false)
    expect(isRisk("answer == '예'", undefined)).toBeNull()
  })
})

describe('체크리스트 데이터와 해석기의 계약', () => {
  it('모든 문항의 risk_rule·applies_if가 해석된다', () => {
    expect(allItems.length).toBeGreaterThan(70)
    for (const it of allItems) {
      expect(() => isRisk(it.risk_rule, it.answer_type === 'number' ? 1 : '예'), it.id).not.toThrow()
      if (it.applies_if) expect(() => evalExpr(it.applies_if!, {}), it.id).not.toThrow()
    }
  })
  it('선택형 문항은 선택지가 있고 규칙의 문자열이 선택지 안에 있다', () => {
    for (const it of allItems) {
      if (it.answer_type === 'single_choice') {
        expect(it.options?.length, it.id).toBeGreaterThan(0)
        for (const m of it.risk_rule.matchAll(/'([^']*)'/g)) expect(it.options, `${it.id} ${m[1]}`).toContain(m[1])
      }
    }
  })
  it('문항 id는 중복되지 않는다', () => {
    expect(new Set(allItems.map((i) => i.id)).size).toBe(allItems.length)
  })
})

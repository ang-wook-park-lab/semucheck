import { evalExpr } from './rules'
import { PROFILE_VARS } from './profile'

// 관리자가 엑셀로 올리거나 서버에 저장된 체크리스트가 앱에서 안전하게 동작하는지 검사한다.
// 서버는 구조만 검사하므로, 규칙 문법·선택지 일치·조건식 변수 같은 "동작" 검사는 여기서 한다.
// 오류가 있으면 올리지 못하게 하고, 이미 저장된 데이터가 오류이면 앱은 원본 체크리스트를 쓴다.

const RISK_TYPES = ['yes_no', 'number', 'single_choice']
const SIGNALS = ['red', 'yellow', 'blue']
const LEVELS = ['high', 'medium', 'low']
const ID_RE = /^[A-Za-z0-9_-]{1,30}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'True', 'False'])

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max

function checkSyntax(expr: string, label: string, errors: string[]) {
  try {
    evalExpr(expr, {})
  } catch (e) {
    errors.push(`${label}: 조건식을 해석할 수 없습니다 (${expr}) — ${(e as Error).message.split(':')[0]}`)
  }
}

export function validateRiskItems(domain: string, data: unknown): string[] {
  const errors: string[] = []
  if (!Array.isArray(data) || data.length === 0) return ['문항이 하나도 없습니다.']
  if (data.length > 500) return ['문항은 500개까지 올릴 수 있습니다.']
  const ids = new Set<string>()
  for (const it of data) if (isObj(it) && typeof it.id === 'string') ids.add(it.id)
  const seen = new Set<string>()
  data.forEach((raw, i) => {
    const at = `${i + 1}번째 문항`
    if (!isObj(raw)) return void errors.push(`${at}: 형식이 올바르지 않습니다.`)
    const it = raw
    const id = typeof it.id === 'string' ? it.id : ''
    const L = id || at
    if (!ID_RE.test(id)) errors.push(`${L}: 문항 ID는 영문·숫자·-·_ 30자 이하여야 합니다.`)
    else if (seen.has(id)) errors.push(`${L}: 문항 ID가 중복됩니다.`)
    seen.add(id)
    if (it.domain !== domain) errors.push(`${L}: domain 은 ${domain} 이어야 합니다.`)
    if (!text(it.category, 100) || !it.category) errors.push(`${L}: 카테고리가 필요합니다.`)
    if (!text(it.question, 1000) || !it.question) errors.push(`${L}: 질문이 필요합니다.`)
    if (!RISK_TYPES.includes(it.answer_type as string)) errors.push(`${L}: 응답유형은 yes_no / number / single_choice 중 하나여야 합니다.`)
    const options = Array.isArray(it.options) ? (it.options as unknown[]).filter((o): o is string => typeof o === 'string' && o !== '') : []
    if (it.answer_type === 'single_choice' && options.length === 0) errors.push(`${L}: 선택형 문항에는 선택지가 필요합니다.`)
    if (!SIGNALS.includes(it.signal as string)) errors.push(`${L}: 신호는 red / yellow / blue 중 하나여야 합니다.`)
    if (!LEVELS.includes(it.risk_level as string)) errors.push(`${L}: 위험도는 high / medium / low 중 하나여야 합니다.`)
    if (it.score_weight !== undefined && !(typeof it.score_weight === 'number' && it.score_weight >= 0 && it.score_weight <= 100)) errors.push(`${L}: 중요도는 0~100 숫자여야 합니다.`)
    if (!text(it.recommendation, 3000) || !it.recommendation) errors.push(`${L}: 개선 권고가 필요합니다.`)
    if (it.verified_at !== undefined && it.verified_at !== '' && !(typeof it.verified_at === 'string' && DATE_RE.test(it.verified_at))) errors.push(`${L}: 확인일은 YYYY-MM-DD 형식이어야 합니다.`)
    // 위험 규칙: 문법과 선택지 일치
    if (typeof it.risk_rule !== 'string' || !it.risk_rule.trim()) errors.push(`${L}: 위험규칙이 필요합니다.`)
    else if (it.risk_rule.trim() !== 'False') {
      checkSyntax(it.risk_rule, `${L} 위험규칙`, errors)
      if (it.answer_type === 'single_choice') {
        for (const m of it.risk_rule.matchAll(/'([^']*)'|"([^"]*)"/g)) {
          const lit = m[1] ?? m[2]
          if (!options.includes(lit)) errors.push(`${L}: 위험규칙의 '${lit}' 이(가) 선택지에 없습니다.`)
        }
      }
    }
    // 적용조건: 문법과 변수(고객사 정보 또는 다른 문항 ID)
    if (it.applies_if !== undefined && it.applies_if !== '') {
      if (typeof it.applies_if !== 'string') errors.push(`${L}: 적용조건 형식이 올바르지 않습니다.`)
      else {
        checkSyntax(it.applies_if, `${L} 적용조건`, errors)
        const stripped = it.applies_if.replace(/'[^']*'|"[^"]*"/g, '')
        for (const w of stripped.match(/[A-Za-z_][A-Za-z0-9_-]*/g) ?? []) {
          if (KEYWORDS.has(w)) continue
          if (w === id) errors.push(`${L}: 적용조건이 자기 자신을 참조합니다.`)
          else if (!(PROFILE_VARS as readonly string[]).includes(w) && !ids.has(w)) errors.push(`${L}: 적용조건의 '${w}' 은(는) 알 수 없는 변수입니다.`)
        }
      }
    }
  })
  return errors
}

export function validateStatusList(domain: string, data: unknown): string[] {
  const errors: string[] = []
  if (!isObj(data) || !Array.isArray(data.areas)) return ['점검표 형식이 올바르지 않습니다(areas 가 필요합니다).']
  if (data.domain !== domain) errors.push(`domain 은 ${domain} 이어야 합니다.`)
  if (!text(data.title, 300) || !data.title) errors.push('title 이 필요합니다.')
  if (!Array.isArray(data.status_options) || data.status_options.length !== 4) errors.push('status_options 는 4개여야 합니다.')
  if (data.areas.length === 0 || data.areas.length > 30) errors.push('영역은 1~30개여야 합니다.')
  const ids = new Set<string>()
  let total = 0
  data.areas.forEach((a: unknown, i: number) => {
    const at = `${i + 1}번째 영역`
    if (!isObj(a) || !text(a.id, 30) || !a.id || !text(a.name, 200) || !a.name || !text(a.key_point, 500)) return void errors.push(`${at}: 영역ID·영역명·핵심포인트가 필요합니다.`)
    if (!Array.isArray(a.items) || a.items.length === 0) return void errors.push(`${at}: 항목이 필요합니다.`)
    a.items.forEach((raw: unknown, j: number) => {
      total++
      const it = isObj(raw) ? raw : {}
      const id = typeof it.id === 'string' ? it.id : ''
      const L = id || `${at} ${j + 1}번째 항목`
      if (!ID_RE.test(id)) errors.push(`${L}: 항목 ID 형식이 올바르지 않습니다.`)
      else if (ids.has(id)) errors.push(`${L}: 항목 ID가 중복됩니다.`)
      ids.add(id)
      if (!text(it.text, 500) || !it.text) errors.push(`${L}: 점검 항목이 필요합니다.`)
      if (!text(it.check, 2000) || !it.check) errors.push(`${L}: 점검 포인트가 필요합니다.`)
      if (!text(it.recommendation, 3000) || !it.recommendation) errors.push(`${L}: 개선 권고가 필요합니다.`)
      if (!LEVELS.includes(it.risk_level as string)) errors.push(`${L}: 위험도는 high / medium / low 중 하나여야 합니다.`)
      if (it.verified_at !== undefined && it.verified_at !== '' && !(typeof it.verified_at === 'string' && DATE_RE.test(it.verified_at))) errors.push(`${L}: 확인일은 YYYY-MM-DD 형식이어야 합니다.`)
    })
  })
  if (total > 500) errors.push('항목은 500개까지 올릴 수 있습니다.')
  return errors
}

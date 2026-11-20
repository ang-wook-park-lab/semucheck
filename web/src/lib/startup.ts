// 창업진단: 창업의 정의에 해당하는지 법령별로 판정한다.
//  - 정책자금·창업지원사업: 중소기업창업 지원법과 시행령(2024.7.10. 개정)의 창업 제외 사유 (책 2부 8장 정리)
//  - 세법: 조세특례제한법 제6조(창업중소기업 등에 대한 세액감면)와 시행령 제5조의 창업 범위
//  - 청년 여부, 수도권과밀억제권역, 감면율(참고)
// 문항은 checklists/startup/startup-diagnosis.json 이고, 이 파일은 그 응답(문항 id)을 읽어 판정한다.
// 법령 해석은 달라질 수 있으므로 모든 결과는 "전문가 확인 전 참고용"이다. 조문 원문을 확인하지 못한 부분은 notes 에 [확인 필요]로 남긴다.
import type { Answer } from './types'
import type { Verdict } from './report'

export type LawStatus = 'ok' | 'ng' | 'check' | 'pending'

export interface LawResult {
  law: string
  status: LawStatus
  headline: string
  /** 판정에 영향을 준 사유(창업으로 보기 어려운 이유 또는 확인할 점) */
  reasons: string[]
  /** 창업 인정이 가능하다고 본 근거나 참고 사항 */
  notes: string[]
}

export type Zone = 'over' | 'metro' | 'non' | 'unknown'

export interface StartupResult {
  support: LawResult
  tax: LawResult
  youth: { status: 'yes' | 'no' | 'check' | 'unknown'; text: string; adjustedAge: number | null; fundYouth: boolean | null }
  zone: { zone: Zone; text: string }
  /** 세법 감면 참고(확정 아님) */
  benefit: string[]
  /** 두 법령의 결과가 갈리는 지점 */
  differences: string[]
  overall: Verdict
}

// 선택지 문구(문항 JSON 과 같은 값)
const CORP = '법인'
const STARTED = '시작함'
const AFTER_2026 = '2026년'
const F_KEEP = '계속 운영 중'
const F_CLOSE = '폐업했음'
const F_SELL = '타인에게 양도'
const F_CONV = '신규 법인에'
const SAME_PLACE = '같은 장소'
const ZONE_OVER = ['서울', '인천광역시 중 과밀', '경기도 과밀']
const ZONE_METRO = ['인천광역시 중 그 밖', '경기도 그 밖']
const ZONE_NON = '수도권 밖'
const IND_OK = '감면 대상'
const IND_NG = '감면 제외'

const CHECK = '[확인 필요]'

const isYes = (v: Answer | undefined) => v === '예'
const isNo = (v: Answer | undefined) => v === '아니오'
const str = (v: Answer | undefined) => (typeof v === 'string' ? v : '')
const num = (v: Answer | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const has = (v: Answer | undefined) => v !== undefined && v !== ''

/** 청년 연령 상한(만). 군 복무 기간은 최대 6년까지 빼서 계산 */
const YOUTH_MAX = 34
const MILITARY_CAP_YEARS = 6

export function zoneOf(a: Record<string, Answer>): { zone: Zone; text: string } {
  const z = str(a['STUP-060'])
  if (!z) return { zone: 'unknown', text: '사업장 소재지를 입력하면 과밀억제권역 여부를 알려 드립니다.' }
  if (ZONE_OVER.some((p) => z.startsWith(p))) {
    return { zone: 'over', text: '수도권정비계획법상 과밀억제권역입니다. 세액감면이 배제되거나 감면율이 낮아집니다(청년 외 창업은 특히 불리).' }
  }
  if (ZONE_METRO.some((p) => z.startsWith(p))) {
    return { zone: 'metro', text: `수도권이지만 과밀억제권역은 아닌 지역입니다. 2026년 이후 창업분은 감면율이 지방보다 낮을 수 있습니다 ${CHECK}.` }
  }
  if (z.startsWith(ZONE_NON)) return { zone: 'non', text: '수도권 밖입니다. 세액감면에서 지역 불이익이 없는 구간입니다.' }
  return { zone: 'unknown', text: '소재지 구분을 확인하세요.' }
}

export function youthOf(a: Record<string, Answer>): StartupResult['youth'] {
  const age = num(a['STUP-010'])
  if (age === undefined) return { status: 'unknown', text: '대표자 나이를 입력하면 청년 여부를 판정합니다.', adjustedAge: null, fundYouth: null }
  const service = Math.min(Math.max(num(a['STUP-011']) ?? 0, 0), MILITARY_CAP_YEARS)
  const adjusted = age - service
  const isYouth = age >= 15 && adjusted <= YOUTH_MAX
  const yearsSince = str(a['STUP-002']).startsWith(STARTED) ? (num(a['STUP-003']) ?? 0) : 0
  const fundYouth = age <= 39 && yearsSince < 3
  const calc = service > 0 ? `만 ${age}세 − 군 복무 ${service}년 = ${adjusted}세` : `만 ${age}세`
  if (!isYouth) {
    return {
      status: 'no',
      adjustedAge: adjusted,
      fundYouth,
      text: `${calc}: 청년창업(만 15~34세, 군 복무 최대 6년 제외)에 해당하지 않습니다.${fundYouth ? ' 다만 만 39세 이하·업력 3년 미만이라 청년 전용 정책자금(공고 확인)은 검토할 수 있습니다.' : ''}`,
    }
  }
  if (str(a['STUP-001']) === CORP && !isYes(a['STUP-012'])) {
    return {
      status: 'check',
      adjustedAge: adjusted,
      fundYouth,
      text: `${calc}: 연령 요건은 충족합니다. 법인은 대표자가 최대주주(최대출자자)인지 등 지분 요건도 확인해야 합니다 ${CHECK}.`,
    }
  }
  return { status: 'yes', adjustedAge: adjusted, fundYouth, text: `${calc}: 청년창업(만 15~34세) 연령 요건을 충족합니다.${fundYouth ? ' 청년 전용 정책자금(만 39세 이하·업력 3년 미만)도 검토할 수 있습니다.' : ''}` }
}

function finish(law: string, ng: string[], check: string[], notes: string[], pending: boolean, okText: string): LawResult {
  if (ng.length) return { law, status: 'ng', headline: '창업으로 인정되기 어렵습니다', reasons: [...ng, ...check], notes }
  if (pending) return { law, status: 'pending', headline: '판정에 필요한 응답이 부족합니다', reasons: check, notes }
  if (check.length) return { law, status: 'check', headline: '추가 확인이 필요합니다', reasons: check, notes }
  return { law, status: 'ok', headline: okText, reasons: [], notes }
}

/** 판정의 출발점이 되는 문항에 응답했는지 */
function gate(a: Record<string, Answer>): boolean {
  return has(a['STUP-001']) && has(a['STUP-020'])
}

function isPending(a: Record<string, Answer>): boolean {
  if (!gate(a)) return true
  return ['STUP-041', 'STUP-043'].some((k) => !has(a[k]))
}

const monthsText = (m: number) => `${m}개월`

export function evaluateSupport(a: Record<string, Answer>): LawResult {
  const law = '정책자금·창업지원사업 (중소기업창업 지원법)'
  const ng: string[] = []
  const check: string[] = []
  const notes: string[] = []
  const corp = str(a['STUP-001']) === CORP
  const prior = isYes(a['STUP-020'])
  const form = str(a['STUP-021'])
  const same = isYes(a['STUP-022'])

  const years = num(a['STUP-003'])
  if (str(a['STUP-002']).startsWith(STARTED) && years !== undefined && years >= 7) ng.push(`창업 후 ${years}년이 지나 창업기업(7년 이내)이 아닙니다.`)

  if (isYes(a['STUP-040'])) ng.push('상속·증여받은 사업을 같은 종류로 이어가는 것은 창업이 아닙니다(이종 전환이면 인정).')
  if (corp && isYes(a['STUP-034'])) ng.push('다른 법인이 발행주식 50%를 초과해 소유한 자회사는 창업으로 인정되지 않습니다.')
  if (corp && isYes(a['STUP-044'])) ng.push('조직변경(주식회사↔유한회사 등)으로 같은 사업을 계속하는 것은 창업이 아닙니다.')

  if (prior && same && form.startsWith(F_KEEP) && corp) {
    const share = num(a['STUP-028'])
    const major = a['STUP-029']
    if ((share !== undefined && share >= 30) || isYes(major)) {
      ng.push(`기존 개인사업을 유지하면서 같은 종류의 법인을 신설하고, 대표자 지분이 ${share !== undefined ? `${share}%` : '30% 이상이거나'} ${isYes(major) ? '최대주주입니다' : '(30% 기준)'}: 창업으로 보지 않습니다.`)
    } else if (share !== undefined && share < 30 && isNo(major)) {
      notes.push(`기존 개인사업을 유지하지만 신규 법인 대표자 지분이 ${share}%(30% 미만)이고 최대주주가 아니라 창업으로 인정될 수 있습니다. 실질 지배 여부는 별도로 확인하세요.`)
    } else {
      check.push('개인사업을 유지한 채 동종 법인을 신설합니다. 대표자 지분율과 최대주주 여부를 입력해야 판정됩니다.')
    }
  }
  if (prior && same && !corp && form.startsWith(F_KEEP)) {
    check.push('기존 개인사업을 유지하면서 같은 종류의 사업을 새로 시작합니다. 별도 창업이 아니라 기존 사업의 확장으로 볼 수 있습니다.')
  }

  if (prior && same && (form.startsWith(F_CLOSE) || form.startsWith(F_SELL))) {
    const m = num(a['STUP-023'])
    const bankrupt = isYes(a['STUP-024'])
    const limit = bankrupt ? 24 : 36
    if (m === undefined) check.push('폐업 후 동종 사업을 다시 시작합니다. 폐업일부터 개시일까지의 개월 수를 입력해야 판정됩니다.')
    else if (m < limit) ng.push(`동종 사업을 폐업한 지 ${monthsText(m)}만에 다시 시작합니다(기준 ${bankrupt ? '부도·파산 2년' : '3년'} 이내): 창업으로 보지 않습니다.`)
    else notes.push(`폐업 후 ${monthsText(m)}이 지나 재개 제한 기간(${bankrupt ? '2년' : '3년'})을 넘겼습니다.`)
  }
  if (prior && form.startsWith(F_CONV)) {
    notes.push('개인사업을 법인으로 전환하면 업력은 개인 개업일부터 기산합니다. 창업 지위는 창업기업인 개인이 본인이 대표인 신설 법인에 사업을 포괄이전한 경우에만 승계됩니다(일부 이전·대표자가 다르면 불인정).')
  }

  if (corp && isYes(a['STUP-030']) && isYes(a['STUP-031'])) {
    const before = num(a['STUP-032'])
    const after = a['STUP-033']
    if (before !== undefined && before > 50 && isYes(after)) {
      ng.push(`기존 법인의 과점주주(대표자·특수관계인 지분 합계 ${before}%)가 신규 법인에서도 과점주주(합계 50% 초과)입니다: 2024.7.10. 개정 기준으로 창업이 부인될 수 있습니다.`)
    } else if (before !== undefined && before <= 50) {
      notes.push(`기존 법인의 지분 합계가 ${before}%로 과점주주(50% 초과)가 아닙니다. 특수관계인 범위를 빠뜨리지 않았는지만 확인하세요.`)
    } else if (before !== undefined && before > 50 && isNo(after)) {
      notes.push('기존 법인의 과점주주이지만 신규 법인에서는 과점주주가 아니어서 창업으로 인정될 수 있습니다.')
    } else {
      check.push('기존 법인 주주 이력이 있고 같은 종류의 사업입니다. 기존·신규 법인의 지분 합계를 입력해야 판정됩니다.')
    }
  }

  if (isYes(a['STUP-041'])) check.push(`합병·분할·사업 양수·현물출자로 종전 사업을 승계합니다. 창업 지원법상 제외 여부는 시행령 원문으로 확인하세요 ${CHECK}.`)
  if (isYes(a['STUP-042'])) check.push(`분사(스핀오프)입니다. 모기업과의 특수관계·사업 이전 범위에 따라 달라집니다 ${CHECK}.`)
  if (isYes(a['STUP-043'])) check.push('기존 사업의 확장·업종 추가로 보일 수 있습니다. 새 사업의 실체를 입증하세요.')
  if (isNo(a['STUP-070'])) check.push('사업자등록상 업종코드가 실제 사업과 달라 동종 판단에서 불이익이 생길 수 있습니다.')

  return finish(law, ng, check, notes, isPending(a) && !ng.length, '창업 제외 사유가 발견되지 않았습니다')
}

export function evaluateTax(a: Record<string, Answer>): LawResult {
  const law = '세법 (조세특례제한법 제6조 창업중소기업 세액감면)'
  const ng: string[] = []
  const check: string[] = []
  const notes: string[] = []
  const prior = isYes(a['STUP-020'])
  const form = str(a['STUP-021'])
  const same = isYes(a['STUP-022'])

  if (isYes(a['STUP-041'])) ng.push('합병·분할·현물출자·사업 양수로 종전 사업을 승계하는 경우는 창업으로 보지 않습니다.')
  if (isYes(a['STUP-040'])) ng.push('상속·증여받은 사업을 이어가는 것은 종전 사업의 승계로 볼 수 있어 창업이 아닙니다.')
  if (isYes(a['STUP-044'])) ng.push('조직변경으로 같은 사업을 계속하는 것은 종전 사업의 승계입니다.')
  if (isYes(a['STUP-043'])) ng.push('사업의 확장(사업장 추가·업종 추가)은 창업이 아닙니다.')

  if (prior && form.startsWith(F_CONV)) {
    const r = num(a['STUP-027'])
    if (r === undefined) check.push('개인사업을 법인으로 전환했습니다. 종전 사업용 자산 중 승계한 비율을 입력해야 판정됩니다(50% 이상 승계 시 창업 아님).')
    else if (r >= 50) ng.push(`개인사업을 법인으로 전환하면서 사업용 자산의 ${r}%를 승계했습니다(50% 이상): 창업으로 보지 않습니다 ${CHECK}.`)
    else check.push(`법인 전환이지만 사업용 자산 승계가 ${r}%(50% 미만)입니다. 자산 외에 인력·거래처 승계 등 실질 승계가 없는지 확인하세요 ${CHECK}.`)
  }
  if (prior && same && (form.startsWith(F_CLOSE) || form.startsWith(F_SELL))) {
    const m = num(a['STUP-023'])
    if (m !== undefined && m < 36) ng.push(`동종 사업을 폐업(양도)한 뒤 ${monthsText(m)}만에 다시 시작합니다: 폐업 후 같은 종류의 사업을 다시 하는 것은 창업이 아닙니다.`)
    else check.push(`폐업 후 같은 종류의 사업을 다시 시작합니다. 세법은 지원법과 달리 기간 기준이 명확하지 않아 시간이 지났어도 실질(설비·거래처 승계)로 판단될 수 있습니다 ${CHECK}.`)
  }
  if (prior && same && form.startsWith(F_KEEP)) {
    const sameSite = str(a['STUP-025']) === SAME_PLACE
    if (isYes(a['STUP-026']) || sameSite) ng.push(`기존 개인사업을 유지하면서 같은 종류의 사업을 ${sameSite ? '같은 장소에서' : ''} ${isYes(a['STUP-026']) ? '기존 설비·인력·거래처를 이어받아' : ''} 시작합니다: 신설이 아니라 사업 확장·승계로 볼 수 있습니다.`)
    else if (isNo(a['STUP-026']) && str(a['STUP-025']).startsWith('다른')) notes.push('기존 사업과 장소가 다르고 설비·인력·거래처 승계가 없어 별개의 신규 사업으로 인정될 여지가 있습니다. 실질 판단이므로 증빙을 남기세요.')
    else check.push('기존 개인사업을 유지하면서 같은 종류의 사업을 시작합니다. 장소와 설비·인력·거래처 승계 여부를 입력해야 판정됩니다.')
  }
  if (isYes(a['STUP-042'])) check.push(`분사(스핀오프)입니다. 신규 기업의 임직원이 모기업과 친족·경영지배 관계에 있는지, 사업 이전 범위가 어디까지인지에 따라 달라집니다 ${CHECK}.`)
  if (str(a['STUP-050']).startsWith(IND_NG)) check.push('업종이 세액감면 제외 대상일 수 있습니다. 창업에는 해당해도 감면은 받지 못할 수 있습니다.')
  else if (has(a['STUP-050']) && !str(a['STUP-050']).startsWith(IND_OK)) check.push('업종코드가 감면 대상 업종인지 확인하지 못했습니다.')
  const years = num(a['STUP-003'])
  if (str(a['STUP-002']).startsWith(STARTED) && years !== undefined && years >= 5) notes.push('사업 개시 후 5년 이상 지나 감면기간(최초 소득 발생 과세연도부터 5년)이 끝났거나 곧 끝날 수 있습니다.')

  return finish(law, ng, check, notes, isPending(a) && !ng.length, '창업으로 보지 않는 사유가 발견되지 않았습니다')
}

/** 세법 세액감면 참고 정보(확정 아님). 개정 내용이 자료마다 달라 모두 [확인 필요]로 표시한다. */
export function benefitLines(a: Record<string, Answer>, youth: StartupResult['youth'], zone: StartupResult['zone']): string[] {
  const lines: string[] = []
  const after = str(a['STUP-004']).startsWith(AFTER_2026)
  const isYouth = youth.status === 'yes'
  const maybeYouth = youth.status === 'check'
  if (zone.zone === 'unknown') lines.push('사업장 소재지를 입력하면 감면율 구간을 안내합니다.')
  else if (!has(a['STUP-004'])) lines.push('창업(개시) 시기를 입력하면 감면율 구간을 안내합니다.')
  else if (!after) {
    if (zone.zone === 'over') lines.push(isYouth ? `청년창업중소기업 + 과밀억제권역 안: 감면율 50% (2025년 이전 창업) ${CHECK}` : maybeYouth ? `청년 요건(지분 등) 확인 결과에 따라: 청년이면 50%, 아니면 과밀억제권역 안 창업은 감면 제외 ${CHECK}` : `청년이 아닌 창업중소기업이 과밀억제권역 안에서 창업하면 원칙적으로 감면 제외입니다(수입금액이 작은 생계형 특례 등은 별도 확인) ${CHECK}`)
    else lines.push(isYouth ? `청년창업중소기업 + 과밀억제권역 밖: 감면율 100% (2025년 이전 창업) ${CHECK}` : maybeYouth ? `청년 요건 확인 결과에 따라 청년이면 100%, 아니면 50% ${CHECK}` : `청년이 아닌 창업중소기업 + 과밀억제권역 밖: 감면율 50% (2025년 이전 창업) ${CHECK}`)
  } else {
    if (zone.zone === 'over') lines.push(isYouth || maybeYouth ? `2026년 이후 창업 + 청년 + 과밀억제권역 안: 50%로 알려져 있습니다 ${CHECK}` : `2026년 이후 창업 + 청년 아님 + 과밀억제권역 안: 감면 제외 가능성이 큽니다 ${CHECK}`)
    else if (zone.zone === 'metro') lines.push(isYouth || maybeYouth ? `2026년 이후 창업 + 청년 + 수도권(과밀억제권역 밖): 75%로 알려져 있습니다 ${CHECK}` : `2026년 이후 창업 + 청년 아님 + 수도권(과밀억제권역 밖): 감면율이 낮아졌다는 자료가 많으나 25%·50% 등 자료마다 달라 조문 확인이 필요합니다 ${CHECK}`)
    else lines.push(isYouth || maybeYouth ? `2026년 이후 창업 + 청년 + 수도권 밖: 100%로 알려져 있습니다 ${CHECK}` : `2026년 이후 창업 + 청년 아님 + 수도권 밖: 일반 창업 감면율은 자료마다 달라 조문 확인이 필요합니다 ${CHECK}`)
    lines.push(`2026년 개정으로 연간 감면 한도(예: 5억 원)가 신설되었다는 자료가 있습니다 ${CHECK}`)
  }
  lines.push('감면기간: 최초로 소득이 발생한 과세연도(소득이 없으면 창업 후 5년이 되는 날이 속하는 과세연도)부터 5년 동안입니다.')
  if (isYes(a['STUP-061'])) lines.push(`창업 후 과밀억제권역 안으로 이전하거나 지점을 설치하면 이후 감면이 배제될 수 있습니다 ${CHECK}`)
  return lines
}

/** 정책자금(창업지원법)과 세법의 판단 기준 비교표(고정 안내) */
export const COMPARE_ROWS: { topic: string; support: string; tax: string }[] = [
  { topic: '근거 법령', support: '중소기업창업 지원법·시행령(창업기업 확인, 정책자금·지원사업)', tax: '조세특례제한법 제6조·시행령 제5조(창업중소기업 세액감면)' },
  { topic: '혜택 기간', support: '창업 후 7년 이내 창업기업', tax: '최초 소득 발생 과세연도부터 5년 감면' },
  { topic: '개인사업 유지 + 동종 법인 신설', support: '대표자 지분 30% 이상 또는 최대주주면 창업 아님', tax: '지분 기준 없음. 종전 사업의 확장·승계인지 실질로 판단(장소·설비·인력·거래처)' },
  { topic: '폐업 후 동종 재개', support: '폐업 후 3년(부도·파산 2년) 이내면 창업 아님', tax: '폐업 후 같은 종류 사업을 다시 하면 창업 아님(기간 기준이 약해 실질 판단) [확인 필요]' },
  { topic: '개인 → 법인 전환', support: '업력은 개인 개업일부터 기산. 포괄이전 시 창업 지위 승계', tax: '사업용 자산 50% 이상 승계 시 창업 아님 [확인 필요]' },
  { topic: '기존 법인의 주주', support: '기존 법인 과점주주가 신규 법인의 과점주주가 되면 창업 아님(특수관계인 합산)', tax: '주주 규정 자체는 없음. 사업 승계·확장 여부로 판단' },
  { topic: '업종·지역', support: '정책자금별 지원 제외 업종 확인', tax: '감면 대상 업종 열거, 수도권과밀억제권역·청년 여부에 따라 감면율 상이' },
  { topic: '청년', support: '청년 전용 자금: 만 39세 이하·업력 3년 미만(공고별 상이)', tax: '청년창업: 만 15~34세(군 복무 최대 6년 제외)' },
]

export function evaluateStartup(a: Record<string, Answer>): StartupResult {
  const support = evaluateSupport(a)
  const tax = evaluateTax(a)
  const youth = youthOf(a)
  const zone = zoneOf(a)
  const differences: string[] = []
  if (support.status === 'ng' && tax.status !== 'ng') differences.push('정책자금(창업지원법) 기준으로는 창업이 아니지만 세법 기준으로는 창업으로 볼 여지가 있습니다. 세액감면과 정책자금 신청 전략을 따로 세우세요.')
  if (tax.status === 'ng' && support.status !== 'ng') differences.push('세법 기준으로는 창업으로 보기 어렵지만 정책자금(창업지원법) 기준으로는 창업기업으로 인정될 수 있습니다. 정책자금은 가능하나 세액감면은 어렵습니다.')
  if (support.reasons.some((r) => r.includes('과점주주')) && !tax.reasons.some((r) => r.includes('과점주주'))) differences.push('기존 법인 과점주주 규정은 창업지원법에만 있고 세법에는 없습니다.')
  if (support.notes.some((n) => n.includes('업력은 개인 개업일부터')) && tax.status === 'ng') differences.push('개인 → 법인 전환은 창업지원법에서는 업력을 승계하지만, 세법에서는 사업용 자산 승계 비율에 따라 창업이 아닐 수 있습니다.')
  return { support, tax, youth, zone, benefit: benefitLines(a, youth, zone), differences, overall: decideStartupVerdict(support, tax) }
}

export function decideStartupVerdict(support: LawResult, tax: LawResult): Verdict {
  if (support.status === 'pending' && tax.status === 'pending') {
    return { level: 'incomplete', title: '창업 판정 보류', text: '사업자 유형과 기존 사업 이력 등 판정에 필요한 문항에 응답하면 법령별 창업 인정 여부를 판정합니다.' }
  }
  const bad = [support.status === 'ng' ? '정책자금(창업지원법)' : '', tax.status === 'ng' ? '세법' : ''].filter(Boolean)
  if (bad.length === 2) return { level: 'urgent', title: '두 법령 모두 창업으로 보기 어렵습니다', text: '창업 제외 사유가 있습니다. 설립 전이라면 구조(지분·시기·업종·사업 이전 범위)를 바꿀 수 있는지 먼저 검토하세요.' }
  if (bad.length === 1) return { level: 'urgent', title: `${bad[0]} 기준으로는 창업이 아닙니다`, text: '법령에 따라 결과가 갈립니다. 인정되는 쪽의 혜택(세액감면 또는 정책자금)을 중심으로 전략을 세우세요.' }
  if (support.status === 'check' || tax.status === 'check') return { level: 'fix', title: '추가 확인이 필요합니다', text: '창업 제외 사유가 확정되지는 않았지만 실질 판단이 필요한 항목이 있습니다. 증빙을 정리하고 전문가에게 확인하세요.' }
  if (support.status === 'pending' || tax.status === 'pending') return { level: 'incomplete', title: '일부 판정 보류', text: '판정에 필요한 일부 문항이 비어 있습니다. 응답을 보완하세요.' }
  return { level: 'good', title: '창업으로 인정될 가능성이 높습니다', text: '응답한 범위에서는 두 법령 모두 창업 제외 사유가 발견되지 않았습니다. 최종 판단은 조문 원문과 전문가 확인을 거치세요.' }
}

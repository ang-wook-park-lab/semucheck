import { evalExpr, isRisk, type Env } from './rules'
import { decideStartupVerdict, evaluateSupport, evaluateTax } from './startup'
import type { Answer, ChecklistItem, Client, ClientProfile, Diagnosis, RiskLevel, Signal } from './types'

export interface Finding {
  item: ChecklistItem
  answer: Answer
  note?: string
}

export interface CategorySummary {
  category: string
  applicable: number
  answered: number
  flagged: number
}

export type VerdictLevel = 'blocked' | 'hold' | 'immediate' | 'prepare' | 'incomplete' | 'good' | 'fix' | 'urgent'

export interface Verdict {
  level: VerdictLevel
  title: string
  text: string
}

export interface FundMatch {
  title: string
  detail: string
}

export interface Report {
  domainKey: string
  client: Client
  applicable: ChecklistItem[]
  answeredCount: number
  unanswered: ChecklistItem[]
  reds: Finding[]
  yellows: Finding[]
  blues: Finding[]
  categories: CategorySummary[]
  /** 0~100. 응답한 감점 문항(빨강·노랑) 가중치 중 해당된 비율 */
  riskIndex: number | null
  /** 0~100. 응답한 가점 문항 중 이미 갖춘 비율 */
  bonusRate: number | null
  verdict: Verdict
  priorities: Finding[]
  roadmap: { now: Finding[]; threeMonths: Finding[]; yearEnd: Finding[]; bonus: Finding[] }
  fundMatches: FundMatch[]
}

export const signalOf = (it: ChecklistItem): Signal => it.signal ?? 'yellow'
export const weightOf = (it: ChecklistItem) => it.score_weight ?? 1

const LEVEL_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

/** applies_if 계산에 쓰는 변수: 고객사 정보 + 이미 응답한 문항(id) */
export function buildEnv(profile: ClientProfile, answers: Record<string, Answer>): Env {
  return { ...profile, ...answers } as Env
}

export function isApplicable(item: ChecklistItem, env: Env): boolean {
  if (!item.applies_if) return true
  return evalExpr(item.applies_if, env) !== false // 알 수 없으면(null) 일단 질문한다
}

/** 수임 불가 판정에 쓰는 결격 문항: 세금 체납 / 신용불량·회생·파산 / 자본잠식 / 진행 중 소송 (책 63장) */
const BLOCKING_IDS = ['FUND-001', 'FUND-004', 'FUND-005', 'FUND-006']

export function buildReport(items: ChecklistItem[], diagnosis: Diagnosis, client: Client): Report {
  const env = buildEnv(client.profile, diagnosis.answers)
  const applicable = items.filter((i) => isApplicable(i, env))
  const reds: Finding[] = []
  const yellows: Finding[] = []
  const blues: Finding[] = []
  const unanswered: ChecklistItem[] = []
  const catMap = new Map<string, CategorySummary>()
  let answeredCount = 0
  let negWeightTotal = 0
  let negWeightFlagged = 0
  let blueAnswered = 0
  let blueHave = 0

  for (const it of applicable) {
    const cat = catMap.get(it.category) ?? { category: it.category, applicable: 0, answered: 0, flagged: 0 }
    cat.applicable++
    catMap.set(it.category, cat)

    const answer = diagnosis.answers[it.id]
    const risk = isRisk(it.risk_rule, answer)
    if (answer === undefined || answer === '') {
      unanswered.push(it)
      continue
    }
    answeredCount++
    cat.answered++
    const sig = signalOf(it)
    const informational = it.risk_rule.trim() === 'False'
    if (!informational) {
      if (sig === 'blue') {
        blueAnswered++
        if (!risk) blueHave++
      } else {
        negWeightTotal += weightOf(it)
        if (risk) negWeightFlagged += weightOf(it)
      }
    }
    if (risk) {
      cat.flagged++
      const f: Finding = { item: it, answer, note: diagnosis.notes[it.id] }
      ;(sig === 'red' ? reds : sig === 'yellow' ? yellows : blues).push(f)
    }
  }

  const bySeverity = (a: Finding, b: Finding) =>
    LEVEL_ORDER[a.item.risk_level] - LEVEL_ORDER[b.item.risk_level] || weightOf(b.item) - weightOf(a.item)
  reds.sort(bySeverity)
  yellows.sort(bySeverity)
  blues.sort((a, b) => weightOf(b.item) - weightOf(a.item))

  const progress = applicable.length ? answeredCount / applicable.length : 0
  const roadmap = {
    now: reds,
    threeMonths: yellows.filter((f) => f.item.risk_level === 'high'),
    yearEnd: yellows.filter((f) => f.item.risk_level !== 'high'),
    bonus: blues,
  }

  return {
    domainKey: diagnosis.domain,
    client,
    applicable,
    answeredCount,
    unanswered,
    reds,
    yellows,
    blues,
    categories: [...catMap.values()],
    riskIndex: negWeightTotal ? Math.round((negWeightFlagged / negWeightTotal) * 100) : null,
    bonusRate: blueAnswered ? Math.round((blueHave / blueAnswered) * 100) : null,
    verdict: decideVerdict(diagnosis, reds, yellows, progress),
    priorities: [...reds, ...yellows].slice(0, 5),
    roadmap,
    fundMatches: diagnosis.domain === 'policy-fund' ? matchFunds(client.profile, diagnosis.answers) : [],
  }
}

function decideVerdict(d: Diagnosis, reds: Finding[], yellows: Finding[], progress: number): Verdict {
  // 창업진단은 응답 진행률이 아니라 판정에 필요한 문항(사업자 유형·기존 사업 이력 등)이 채워졌는지로 판정을 보류한다
  if (d.domain === 'startup') return decideStartupVerdict(evaluateSupport(d.answers), evaluateTax(d.answers))
  if (progress < 0.6) {
    return {
      level: 'incomplete',
      title: '진단 미완료',
      text: `전체 문항의 ${Math.round(progress * 100)}%만 응답했습니다. 60% 이상 응답해야 판정을 제시합니다. 아래 결과는 응답한 문항 기준입니다.`,
    }
  }
  if (d.domain !== 'policy-fund') {
    if (reds.length) return { level: 'urgent', title: '즉시 조치 필요', text: '즉시 시정이 필요한 빨강 문항이 있습니다. 해결 과제를 먼저 처리하세요.' }
    if (yellows.length) return { level: 'fix', title: '보완 필요', text: '보완이 필요한 노랑 문항이 있습니다. 보완 로드맵 순서대로 정비하세요.' }
    return { level: 'good', title: '양호', text: '응답한 범위에서 위험 요인이 발견되지 않았습니다.' }
  }
  if (reds.some((f) => BLOCKING_IDS.includes(f.item.id))) {
    return {
      level: 'blocked',
      title: '수임 불가 (결격 해소 선행)',
      text: '세금 체납·신용불량·자본잠식·진행 중 소송 중 하나 이상이 해당합니다. 결격을 해소한 뒤 다시 진단하세요.',
    }
  }
  if (reds.length) {
    return {
      level: 'hold',
      title: '지금은 신청 불가 · 결격 해결 후 진행',
      text: '빨강(결격) 문항이 해당합니다. 해결 과제를 우선 처리해야 정책자금 신청이 가능합니다.',
    }
  }
  const a = d.answers
  const credit = typeof a['FUND-017'] === 'number' ? (a['FUND-017'] as number) <= 5 : false
  const sales = a['FUND-023'] === '증가'
  const purpose = a['FUND-042'] === '예'
  const cert =
    (a['FUND-033'] !== undefined && a['FUND-033'] !== '없음') ||
    a['FUND-034'] === '예' ||
    (a['FUND-035'] !== undefined && a['FUND-035'] !== '없음')
  if (credit && sales && purpose && cert) {
    return {
      level: 'immediate',
      title: '즉시 수임 가능',
      text: '빨강 0개 + 대표 신용 5등급 이내 + 매출 증가 + 자금 목적 명확 + 인증 1개 이상을 모두 충족합니다.',
    }
  }
  return {
    level: 'prepare',
    title: '준비 후 수임',
    text: `빨강은 없지만 노랑 ${yellows.length}건 등 보완이 필요합니다. 3개월 준비 로드맵으로 진행하세요.`,
  }
}

/** 추천 자금 매칭 (책 2·55·62·67장). 금리·한도는 공고에 따라 바뀌므로 화면에 "최신 공고 확인 필요"를 함께 표시한다. */
export function matchFunds(p: ClientProfile, a: Record<string, Answer>): FundMatch[] {
  const out: FundMatch[] = []
  if (p.employees < 5) out.push({ title: '상시 5인 미만(소상공인)', detail: '소진공 자금(일반경영안정·성장기반 등) + 지역 신용보증재단' })
  if (p.business_age < 7) {
    out.push({ title: '업력 7년 미만', detail: '중진공 창업기반지원(청년 39세 이하·3년 미만은 청년전용) + 기보 기술보증 + 창업성장 R&D' })
  } else {
    out.push({ title: '업력 7년 이상', detail: '설비투자 시 중진공 신성장기반·혁신성장지원 시설자금 + 기보·신보 운전자금' })
  }
  const credit = a['FUND-016']
  const creditOk = typeof credit === 'string' && ['A 이상', 'BBB', 'BB+', 'BB'].includes(credit)
  const cert = a['FUND-034'] === '예' || (a['FUND-035'] !== undefined && a['FUND-035'] !== '없음')
  if (creditOk && cert) {
    const high = credit === 'A 이상' || credit === 'BBB' || credit === 'BB+'
    out.push({ title: '신용 BB 이상 + 벤처·이노비즈', detail: high ? '한은 C2 온렌딩, BB+ 이상이므로 산은 온렌딩도 검토' : '한은 C2 온렌딩 (BB+ 이상이면 산은 온렌딩)' })
  }
  if (typeof a['FUND-036'] === 'number' && (a['FUND-036'] as number) > 0) {
    out.push({ title: '특허 보유', detail: '기보 IP보증(특신전 조합 최대 3억), 신보 IP 우대보증, 중진공 개발기술사업화' })
  }
  const sales = a['FUND-023']
  if (typeof sales === 'string' && sales.includes('감소')) {
    out.push({ title: '매출 감소', detail: '감소폭이 10% 이상이면 중진공 긴급경영안정(수시 접수), 소진공은 15% 감소 기준 — 감소 증빙 확인' })
  }
  return out
}

// 기업신용등급 진단: 입력한 재무 숫자로 재무비율을 계산하고, 기준과 비교해 등급 준비도와 개선 과제를 만든다.
//  - 구조(책 15부): 기업등급 = 재무 70% + 비재무 25% + 기술 5%
//  - 재무비율 기준·5대 위험 항목·정리 우선순위: 정책자금 도서 69~73장 정리(knowledge/credit/README.md)
// ★ 이 결과는 "등급 준비도(참고용 추정)"이며 실제 신용평가사(NICE평가정보·한국기업데이터·이크레더블)의 모형·등급과 다릅니다.
//   평가사별 세부 가중치와 업종별 기준은 공개되지 않으므로, 업종 평균이 필요한 지표는 [확인 필요]로 표시합니다.
import { evalExpr, isRisk, type Env } from './rules'
import type { Answer, ChecklistItem } from './types'

export type RatioStatus = 'good' | 'watch' | 'bad' | 'na'

export interface RatioRow {
  key: string
  label: string
  group: '성장성' | '수익성' | '안정성' | '활동성' | '5대 위험'
  value: number | null
  display: string
  criterion: string
  status: RatioStatus
  weight: number
  note?: string
}

export interface CreditFinding {
  item: ChecklistItem
  answer: Answer
}

export interface TargetRow {
  label: string
  text: string
}

export type CreditBand = 'high' | 'mid' | 'low' | 'weak' | 'unknown'

export interface CreditResult {
  ratios: RatioRow[]
  /** 재무비율 분석에서 나온 개선 과제(보고서의 우선순위·로드맵에 합쳐진다) */
  findings: CreditFinding[]
  scores: { financial: number | null; nonfinancial: number | null; tech: number | null; total: number | null }
  band: { key: CreditBand; label: string; text: string }
  targets: TargetRow[]
  goalGap: string
  /** 분석에 쓸 수 있는 재무 입력의 개수(0이면 재무 분석 불가) */
  usableRatios: number
  /** 즉시 위험 신호 때문에 점수 상한을 적용했으면 그 안내 */
  capNote: string | null
}

const num = (v: Answer | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const has = (v: Answer | undefined) => v !== undefined && v !== ''

/** 화면용 숫자(백만원 단위 입력). 천 단위 쉼표 */
export const fmtMoney = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}백만원`
const fmtPct = (v: number) => `${(Math.round(v * 10) / 10).toLocaleString('ko-KR')}%`
const fmtX = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString('ko-KR')}배`
const fmtDays = (v: number) => `${Math.round(v)}일`

interface Inputs {
  sales?: number
  salesPrev?: number
  op?: number
  opPrev?: number
  interest?: number
  ni?: number
  assets?: number
  debt?: number
  equity?: number
  capital?: number
  ca?: number
  cl?: number
  ar?: number
  inv?: number
  borrow?: number
  suspense?: number // 가지급금
  deposit?: number // 가수금
  devCost?: number // 개발비
}

export function readInputs(a: Record<string, Answer>): Inputs {
  return {
    sales: num(a['CRD-010']), salesPrev: num(a['CRD-011']), op: num(a['CRD-012']), opPrev: num(a['CRD-013']),
    interest: num(a['CRD-014']), ni: num(a['CRD-015']), assets: num(a['CRD-016']), debt: num(a['CRD-017']),
    equity: num(a['CRD-018']), capital: num(a['CRD-019']), ca: num(a['CRD-020']), cl: num(a['CRD-021']),
    ar: num(a['CRD-022']), inv: num(a['CRD-023']), borrow: num(a['CRD-024']),
    suspense: num(a['CRD-025']), deposit: num(a['CRD-026']), devCost: num(a['CRD-027']),
  }
}

const row = (r: Omit<RatioRow, 'display' | 'status'> & { display?: string; status?: RatioStatus }): RatioRow => ({
  display: r.value === null ? '입력 필요' : '',
  status: r.value === null ? 'na' : 'good',
  ...r,
})

/** 재무비율 15개 지표(책 70장) 중 입력으로 계산할 수 있는 것과 5대 위험 항목을 판정한다 */
export function computeRatios(i: Inputs): RatioRow[] {
  const out: RatioRow[] = []
  const pos = (v: number | undefined): v is number => v !== undefined && v > 0

  // 성장성
  if (pos(i.salesPrev) && i.sales !== undefined) {
    const g = ((i.sales - i.salesPrev) / i.salesPrev) * 100
    out.push(row({ key: 'salesGrowth', label: '매출액증가율', group: '성장성', value: g, display: fmtPct(g), criterion: '10% 이상 양호 · 마이너스 주의 · −30% 이하 즉시 위험', weight: 2, status: g <= -30 ? 'bad' : g < 0 ? 'bad' : g < 10 ? 'watch' : 'good', note: '부가세 신고액과 일치해야 인정됩니다' }))
  } else out.push(row({ key: 'salesGrowth', label: '매출액증가율', group: '성장성', value: null, criterion: '10% 이상 양호 · −30% 이하 즉시 위험', weight: 2 }))

  // 수익성
  if (pos(i.sales) && i.op !== undefined) {
    const m = (i.op / i.sales) * 100
    const prevM = pos(i.salesPrev) && i.opPrev !== undefined ? (i.opPrev / i.salesPrev) * 100 : null
    const drop = prevM !== null ? prevM - m : null
    out.push(row({ key: 'opMargin', label: '매출액영업이익률', group: '수익성', value: m, display: `${fmtPct(m)}${drop !== null && drop >= 2 ? ` (전년 대비 ${fmtPct(drop)}p 하락)` : ''}`, criterion: '업종 평균 이상 · 적자는 위험 · 전년 대비 2%p 이상 하락 시 주의', weight: 3, status: m < 0 ? 'bad' : drop !== null && drop >= 2 ? 'watch' : 'good', note: '업종 평균과의 비교가 필요합니다 [확인 필요]' }))
  } else out.push(row({ key: 'opMargin', label: '매출액영업이익률', group: '수익성', value: null, criterion: '업종 평균 이상 · 적자는 위험', weight: 3 }))

  if (i.op !== undefined && i.interest !== undefined) {
    if (i.interest <= 0) out.push(row({ key: 'icr', label: '이자보상배율', group: '수익성', value: null, display: '이자비용 없음', criterion: '3배 이상 안정 · 1배 미만 위험', weight: 3, status: 'good' }))
    else {
      const icr = i.op / i.interest
      out.push(row({ key: 'icr', label: '이자보상배율', group: '수익성', value: icr, display: fmtX(icr), criterion: '3배 이상 안정 · 1배 미만 위험(즉시 위험 신호)', weight: 3, status: icr < 1 ? 'bad' : icr < 3 ? 'watch' : 'good' }))
    }
  } else out.push(row({ key: 'icr', label: '이자보상배율', group: '수익성', value: null, criterion: '3배 이상 안정 · 1배 미만 위험', weight: 3 }))

  if (i.ni !== undefined && pos(i.assets)) {
    const roa = (i.ni / i.assets) * 100
    out.push(row({ key: 'roa', label: '총자산순이익률(ROA)', group: '수익성', value: roa, display: fmtPct(roa), criterion: '3% 이상 양호 · 마이너스 주의', weight: 1, status: roa < 0 ? 'bad' : roa < 3 ? 'watch' : 'good' }))
  } else out.push(row({ key: 'roa', label: '총자산순이익률(ROA)', group: '수익성', value: null, criterion: '3% 이상 양호', weight: 1 }))

  // 안정성
  if (i.debt !== undefined && i.equity !== undefined) {
    if (i.equity <= 0) out.push(row({ key: 'debtRatio', label: '부채비율', group: '안정성', value: null, display: '자본잠식(계산 불가)', criterion: '200% 이하(업종별 기준 상이)', weight: 3, status: 'bad' }))
    else {
      const d = (i.debt / i.equity) * 100
      out.push(row({ key: 'debtRatio', label: '부채비율', group: '안정성', value: d, display: fmtPct(d), criterion: '200% 이하 양호 · 400% 초과 위험', weight: 3, status: d > 400 ? 'bad' : d > 200 ? 'watch' : 'good', note: '신용평가는 업종 평균 기준으로 봅니다(같은 110%도 건설업은 감점) [확인 필요]' }))
    }
  } else out.push(row({ key: 'debtRatio', label: '부채비율', group: '안정성', value: null, criterion: '200% 이하(업종별 상이)', weight: 3 }))

  if (pos(i.assets) && i.equity !== undefined) {
    const e = (i.equity / i.assets) * 100
    out.push(row({ key: 'equityRatio', label: '자기자본비율', group: '안정성', value: e, display: fmtPct(e), criterion: '40% 이상 양호 · 20% 미만 위험', weight: 2, status: e < 20 ? 'bad' : e < 40 ? 'watch' : 'good' }))
  } else out.push(row({ key: 'equityRatio', label: '자기자본비율', group: '안정성', value: null, criterion: '40% 이상 양호', weight: 2 }))

  if (pos(i.cl) && i.ca !== undefined) {
    const c = (i.ca / i.cl) * 100
    out.push(row({ key: 'currentRatio', label: '유동비율', group: '안정성', value: c, display: fmtPct(c), criterion: '150% 이상 안정 · 100% 미만 주의', weight: 2, status: c < 100 ? 'bad' : c < 150 ? 'watch' : 'good' }))
  } else out.push(row({ key: 'currentRatio', label: '유동비율', group: '안정성', value: null, criterion: '150% 이상 안정', weight: 2 }))

  if (pos(i.assets) && i.borrow !== undefined) {
    const b = (i.borrow / i.assets) * 100
    out.push(row({ key: 'borrowDep', label: '차입금의존도', group: '안정성', value: b, display: fmtPct(b), criterion: '30% 이하 안정 · 50% 초과 위험', weight: 2, status: b > 50 ? 'bad' : b > 30 ? 'watch' : 'good' }))
  } else out.push(row({ key: 'borrowDep', label: '차입금의존도', group: '안정성', value: null, criterion: '30% 이하 안정', weight: 2 }))

  // 활동성
  if (pos(i.sales) && i.ar !== undefined) {
    const days = (i.ar / i.sales) * 365
    out.push(row({ key: 'arDays', label: '매출채권 회수기간', group: '활동성', value: days, display: fmtDays(days), criterion: '60일 이하 양호 · 90일 초과 위험(회전율이 낮으면 자금난 신호)', weight: 1, status: days > 90 ? 'bad' : days > 60 ? 'watch' : 'good', note: '업종별로 다릅니다 [확인 필요]' }))
  } else out.push(row({ key: 'arDays', label: '매출채권 회수기간', group: '활동성', value: null, criterion: '60일 이하 양호', weight: 1 }))

  if (pos(i.sales) && i.inv !== undefined) {
    const days = (i.inv / i.sales) * 365
    out.push(row({ key: 'invDays', label: '재고자산 보유기간', group: '활동성', value: days, display: fmtDays(days), criterion: '업종별 상이 · 120일 초과 시 과잉 재고 주의', weight: 1, status: days > 120 ? 'watch' : 'good', note: '업종별로 다릅니다 [확인 필요]' }))
  } else out.push(row({ key: 'invDays', label: '재고자산 보유기간', group: '활동성', value: null, criterion: '업종별 상이', weight: 1 }))

  // 5대 위험 항목(책 70장): 가지급금·가수금·개발비·자본잠식·영업이익 적자
  const eq = i.equity
  const eqPos = eq !== undefined && eq > 0
  if (i.suspense !== undefined) {
    out.push(row({ key: 'suspense', label: '가지급금', group: '5대 위험', value: i.suspense, display: i.suspense > 0 ? fmtMoney(i.suspense) : '없음', criterion: '없는 것이 정상(자금 유출·불투명성) · 자기자본의 20% 이상은 심각', weight: 4, status: i.suspense <= 0 ? 'good' : 'bad', note: '신보 CCRS 하향 사유 [확인 필요: 기준 금액]' }))
  } else out.push(row({ key: 'suspense', label: '가지급금', group: '5대 위험', value: null, criterion: '없는 것이 정상', weight: 4 }))

  if (i.deposit !== undefined) {
    out.push(row({ key: 'deposit', label: '가수금', group: '5대 위험', value: i.deposit, display: i.deposit > 0 ? fmtMoney(i.deposit) : '없음', criterion: '잠재 유동부채 · 장기차입금 전환 또는 출자전환(DES) 검토', weight: 3, status: i.deposit <= 0 ? 'good' : 'watch' }))
  } else out.push(row({ key: 'deposit', label: '가수금', group: '5대 위험', value: null, criterion: '없는 것이 정상', weight: 3 }))

  if (i.devCost !== undefined) {
    const ratio = eqPos ? (i.devCost / eq!) * 100 : null
    out.push(row({ key: 'devCost', label: '개발비(무형자산)', group: '5대 위험', value: i.devCost, display: i.devCost > 0 ? `${fmtMoney(i.devCost)}${ratio !== null ? ` (자기자본의 ${fmtPct(ratio)})` : ''}` : '없음', criterion: '효익이 불확실한 개발비는 허수 자산 · 자기자본의 30% 이상 주의', weight: 2, status: i.devCost <= 0 ? 'good' : ratio !== null && ratio >= 30 ? 'watch' : 'good' }))
  } else out.push(row({ key: 'devCost', label: '개발비(무형자산)', group: '5대 위험', value: null, criterion: '효익 불확실 시 비용처리', weight: 2 }))

  if (eq !== undefined) {
    const full = eq <= 0
    const partial = !full && i.capital !== undefined && eq < i.capital
    out.push(row({ key: 'impair', label: '자본잠식', group: '5대 위험', value: eq, display: full ? '완전자본잠식' : partial ? '부분자본잠식' : '없음', criterion: '자기자본이 납입자본금보다 작으면 잠식(기술적 파산 신호)', weight: 5, status: full || partial ? 'bad' : 'good' }))
  } else out.push(row({ key: 'impair', label: '자본잠식', group: '5대 위험', value: null, criterion: '자기자본 ≥ 납입자본금', weight: 5 }))

  if (i.op !== undefined) {
    out.push(row({ key: 'opLoss', label: '영업이익', group: '5대 위험', value: i.op, display: i.op < 0 ? `적자 ${fmtMoney(i.op)}` : fmtMoney(i.op), criterion: '흑자여야 함(이자도 못 버는 구조 방지)', weight: 4, status: i.op < 0 ? 'bad' : 'good' }))
  } else out.push(row({ key: 'opLoss', label: '영업이익', group: '5대 위험', value: null, criterion: '흑자', weight: 4 }))
  return out
}

let seq = 0
const synth = (id: string, category: string, question: string, signal: 'red' | 'yellow', level: 'high' | 'medium' | 'low', weight: number, recommendation: string, consequence: string, legal: string, answer: string): CreditFinding => ({
  item: {
    id,
    domain: 'credit',
    category,
    question,
    answer_type: 'yes_no',
    risk_rule: 'False',
    signal,
    risk_level: level,
    score_weight: weight,
    recommendation,
    consequence,
    legal_basis: legal,
    source: '재무비율 자동 분석(책 70장 기준)',
    verified_at: '',
  },
  answer,
})

/** 재무비율에서 개선이 필요한 항목을 보고서의 우선순위·로드맵에 합칠 수 있는 형태로 만든다 */
export function ratioFindings(a: Record<string, Answer>): CreditFinding[] {
  seq = 0
  const i = readInputs(a)
  const rows = computeRatios(i)
  const by = (k: string) => rows.find((r) => r.key === k)!
  const out: CreditFinding[] = []
  const id = () => `CRD-R${String(++seq).padStart(2, '0')}`
  const C = '재무비율 분석'
  const book = '정책자금 도서 70장'

  // 즉시: 가지급금 → 자본잠식 (책의 정리 우선순위)
  const sus = by('suspense')
  if (sus.status === 'bad') out.push(synth(id(), C, `가지급금이 있습니다 (${sus.display})`, 'red', 'high', 5, '급여·상여·배당·상환으로 즉시 정리하세요(대표자 자금 유출·불투명성). 정리 방식은 세무사와 사전 협의(인정이자·소득세 영향 확인).', '신보 CCRS 하향 사유 · 자금 유출로 평가', book, sus.display))
  const imp = by('impair')
  if (imp.status === 'bad') out.push(synth(id(), C, `자본잠식 상태입니다 (${imp.display})`, 'red', 'high', 5, '증자(또는 출자전환)와 이익 유보로 자기자본을 납입자본금 이상으로 회복하세요. 완전잠식이면 정책자금·보증 심사가 사실상 중단됩니다.', '기술적 파산 신호 · 정책자금·보증 제한', book, imp.display))
  const icr = by('icr')
  if (icr.status === 'bad') out.push(synth(id(), C, `이자보상배율이 1배 미만입니다 (${icr.display})`, 'red', 'high', 5, '영업이익을 이자비용 이상으로 만들거나 고금리 차입을 상환·대환해 이자비용을 줄이세요. 즉시 위험 신호로 분류됩니다.', '이자를 영업이익으로 못 갚는 구조 → 큰 폭 감점', book, icr.display))
  const g = by('salesGrowth')
  if (g.value !== null && g.value <= -30) out.push(synth(id(), C, `매출이 30% 이상 감소했습니다 (${g.display})`, 'red', 'high', 5, '감소 원인(거래처 이탈·수출·일시적 요인)을 정리하고, 신규 거래처·수주 증빙을 사업현황서에 보강하세요.', '즉시 위험 신호', book, g.display))
  else if (g.status === 'bad') out.push(synth(id(), C, `매출이 감소했습니다 (${g.display})`, 'yellow', 'medium', 3, '감소 원인을 설명할 자료와 회복 계획(수주·신규 거래처)을 준비하세요.', '성장성 지표 감점', book, g.display))

  // 3개월: 가수금 → 개발비 비용처리 → 영업적자
  const dep = by('deposit')
  if (dep.status === 'watch') out.push(synth(id(), C, `가수금이 있습니다 (${dep.display})`, 'yellow', 'high', 4, '장기차입금으로 전환하거나 출자전환(DES)해 잠재 유동부채를 정리하세요.', '잠재 유동부채로 보아 유동성 평가 하락', book, dep.display))
  const dev = by('devCost')
  if (dev.status === 'watch') out.push(synth(id(), C, `개발비(무형자산)가 자기자본 대비 큽니다 (${dev.display})`, 'yellow', 'high', 3, '효익이 불확실한 개발비는 비용 처리·상각해 허수 자산을 줄이세요(세무사 사전 협의).', '허수 자산으로 보아 자본의 질 평가 하락', book, dev.display))
  const loss = by('opLoss')
  if (loss.status === 'bad') out.push(synth(id(), C, `영업이익이 적자입니다 (${loss.display})`, 'yellow', 'high', 4, '원가 개선·비용 삭감과 가결산으로 결산 전에 영업이익 흑자 구조를 만드세요.', '이자도 못 버는 구조 → 수익성 감점', book, loss.display))

  // 결산 전: 부채비율·유동성·차입금·자기자본비율·회전
  const debt = by('debtRatio')
  if (debt.status === 'bad' && debt.value !== null) out.push(synth(id(), C, `부채비율이 400%를 넘습니다 (${debt.display})`, 'red', 'high', 5, '증자·이익 유보·부채 상환으로 200% 이하를 목표로 하세요. 특허 등 무형자산 가치 인정으로 자본을 늘리는 방법도 검토합니다.', '업종 평균 대비 큰 폭 감점', book, debt.display))
  else if (debt.status === 'watch') out.push(synth(id(), C, `부채비율이 200%를 넘습니다 (${debt.display})`, 'yellow', 'high', 4, '결산 전 가결산으로 부채비율 200% 이하를 목표로 증자·이익 유보·부채 상환을 설계하세요.', '안정성 감점', book, debt.display))
  const cur = by('currentRatio')
  if (cur.status === 'bad') out.push(synth(id(), C, `유동비율이 100% 미만입니다 (${cur.display})`, 'yellow', 'medium', 3, '단기차입금을 장기로 전환하고 유동자산(현금성)을 확충해 150% 이상을 목표로 하세요.', '단기 지급능력 감점', book, cur.display))
  const bd = by('borrowDep')
  if (bd.status === 'bad') out.push(synth(id(), C, `차입금의존도가 50%를 넘습니다 (${bd.display})`, 'red', 'medium', 4, '차입금을 줄이고 자기자본 비중을 높여 30% 이하를 목표로 하세요.', '재무 안정성 큰 폭 감점', book, bd.display))
  else if (bd.status === 'watch') out.push(synth(id(), C, `차입금의존도가 30%를 넘습니다 (${bd.display})`, 'yellow', 'medium', 3, '고금리 차입부터 상환·대환해 30% 이하로 낮추세요.', '재무 안정성 감점', book, bd.display))
  const eqr = by('equityRatio')
  if (eqr.status === 'bad') out.push(synth(id(), C, `자기자본비율이 20% 미만입니다 (${eqr.display})`, 'yellow', 'medium', 3, '증자와 이익 유보로 자기자본을 늘려 40% 이상을 목표로 하세요.', '자본 안정성 감점', book, eqr.display))
  const opm = by('opMargin')
  if (opm.status === 'watch') out.push(synth(id(), C, `영업이익률이 전년보다 크게 하락했습니다 (${opm.display})`, 'yellow', 'medium', 3, '하락 원인(원가·판관비·일회성)을 분석하고 가결산으로 비용 구조를 점검하세요.', '수익성 감점(전년 대비 2%p 이상 하락)', book, opm.display))
  const ar = by('arDays')
  if (ar.status === 'bad') out.push(synth(id(), C, `매출채권 회수기간이 깁니다 (${ar.display})`, 'yellow', 'low', 2, '회수 조건을 점검하고 팩토링·매출채권 담보 활용을 검토하세요.', '자금난 신호로 활동성 감점', book, ar.display))
  const inv = by('invDays')
  if (inv.status === 'watch') out.push(synth(id(), C, `재고자산 보유기간이 깁니다 (${inv.display})`, 'yellow', 'low', 1, '과잉 재고를 정리하고 동산담보 활용을 검토하세요(업종 평균과 비교).', '활동성 감점', book, inv.display))
  const roa = by('roa')
  if (roa.status === 'bad') out.push(synth(id(), C, `당기순손실로 총자산순이익률이 마이너스입니다 (${roa.display})`, 'yellow', 'medium', 2, '결손 원인을 정리하고 흑자 전환 계획을 마련하세요.', '수익성 감점', book, roa.display))
  return out
}

/** 목표 기준을 맞추려면 얼마가 필요한지 계산한다(참고용) */
export function improvementTargets(i: Inputs): TargetRow[] {
  const out: TargetRow[] = []
  if (i.debt !== undefined && i.equity !== undefined && i.equity > 0 && i.debt / i.equity > 2) {
    const addEquity = i.debt / 2 - i.equity
    const cutDebt = i.debt - 2 * i.equity
    out.push({ label: '부채비율 200% 달성', text: `자기자본을 ${fmtMoney(addEquity)} 늘리거나(증자·이익 유보), 부채를 ${fmtMoney(cutDebt)} 갚으면 200%가 됩니다(둘 중 하나).` })
  }
  if (i.equity !== undefined && i.equity <= 0 && i.capital !== undefined) {
    out.push({ label: '자본잠식 해소', text: `납입자본금(${fmtMoney(i.capital)}) 이상으로 회복하려면 자기자본을 ${fmtMoney(i.capital - i.equity)} 늘려야 합니다.` })
  } else if (i.equity !== undefined && i.capital !== undefined && i.equity > 0 && i.equity < i.capital) {
    out.push({ label: '부분자본잠식 해소', text: `자기자본을 ${fmtMoney(i.capital - i.equity)} 늘리면 납입자본금 수준으로 회복됩니다.` })
  }
  if (i.op !== undefined && i.interest !== undefined && i.interest > 0 && i.op / i.interest < 3) {
    const need = 3 * i.interest
    out.push({ label: '이자보상배율 3배 달성', text: `영업이익이 ${fmtMoney(Math.max(need - i.op, 0))} 더 필요합니다(목표 ${fmtMoney(need)}). 또는 이자비용을 ${fmtMoney(Math.max(i.interest - Math.max(i.op, 0) / 3, 0))} 줄여도 됩니다.` })
  }
  if (i.ca !== undefined && i.cl !== undefined && i.cl > 0 && i.ca / i.cl < 1.5) {
    out.push({ label: '유동비율 150% 달성', text: `유동자산을 ${fmtMoney(1.5 * i.cl - i.ca)} 늘리거나, 유동부채를 ${fmtMoney(i.cl - i.ca / 1.5)} 줄이거나 장기부채로 전환하면 됩니다(둘 중 하나).` })
  }
  if (i.borrow !== undefined && i.assets !== undefined && i.assets > 0 && i.borrow / i.assets > 0.3) {
    out.push({ label: '차입금의존도 30% 달성', text: `차입금을 ${fmtMoney(i.borrow - 0.3 * i.assets)} 줄이면 30%가 됩니다.` })
  }
  if (i.equity !== undefined && i.assets !== undefined && i.assets > 0 && i.equity > 0 && i.equity / i.assets < 0.4) {
    out.push({ label: '자기자본비율 40% 달성', text: `증자로 자기자본을 ${fmtMoney((0.4 * i.assets - i.equity) / 0.6)} 늘리면 40%가 됩니다(자산도 같이 늘어난다고 가정).` })
  }
  if (i.suspense !== undefined && i.suspense > 0) {
    out.push({ label: '가지급금 정리', text: `${fmtMoney(i.suspense)}을 급여·상여·배당·상환으로 정리하세요(세금 영향은 세무사와 사전 협의).` })
  }
  if (i.deposit !== undefined && i.deposit > 0) {
    out.push({ label: '가수금 정리', text: `${fmtMoney(i.deposit)}을 장기차입금으로 전환하거나 출자전환(DES)하세요.` })
  }
  return out
}

const GROUP_WEIGHT = { financial: 0.7, nonfinancial: 0.25, tech: 0.05 } as const

/** 체크리스트 카테고리를 책의 3요소(재무·비재무·기술)로 나눈다 */
export function groupOfCategory(category: string): 'financial' | 'nonfinancial' | 'tech' | null {
  if (/^A\.|^B\./.test(category)) return null // 등급 현황·재무 자료 입력은 점수에 직접 넣지 않는다
  if (category.includes('비재무') || category.includes('신용 이력')) return 'nonfinancial'
  if (category.includes('기술')) return 'tech'
  return 'financial'
}

const STATUS_VALUE: Record<RatioStatus, number> = { good: 1, watch: 0.55, bad: 0, na: 0 }
const SIGNAL_VALUE = { red: 0, yellow: 0.4, blue: 0.75 } as const

function applicable(item: ChecklistItem, a: Record<string, Answer>): boolean {
  if (!item.applies_if) return true
  return evalExpr(item.applies_if, a as Env) !== false
}

export function evaluateCredit(a: Record<string, Answer>, items: ChecklistItem[]): CreditResult {
  const inputs = readInputs(a)
  const ratios = computeRatios(inputs)
  const usable = ratios.filter((r) => r.status !== 'na' || r.display === '이자비용 없음')
  const findings = ratioFindings(a)

  const acc = { financial: { sum: 0, w: 0 }, nonfinancial: { sum: 0, w: 0 }, tech: { sum: 0, w: 0 } }
  for (const r of ratios) {
    if (r.status === 'na') continue
    acc.financial.sum += r.weight * STATUS_VALUE[r.status]
    acc.financial.w += r.weight
  }
  for (const it of items) {
    const g = groupOfCategory(it.category)
    if (!g || !applicable(it, a)) continue
    const ans = a[it.id]
    if (!has(ans) || it.risk_rule.trim() === 'False') continue
    const w = it.score_weight ?? 1
    const flagged = isRisk(it.risk_rule, ans) === true
    acc[g].sum += w * (flagged ? SIGNAL_VALUE[it.signal ?? 'yellow'] : 1)
    acc[g].w += w
  }
  const score = (g: keyof typeof acc) => (acc[g].w > 0 ? Math.round((acc[g].sum / acc[g].w) * 100) : null)
  const financial = score('financial')
  const nonfinancial = score('nonfinancial')
  const tech = score('tech')
  let wsum = 0
  let total = 0
  for (const [k, v] of Object.entries({ financial, nonfinancial, tech }) as ['financial' | 'nonfinancial' | 'tech', number | null][]) {
    if (v === null) continue
    total += v * GROUP_WEIGHT[k]
    wsum += GROUP_WEIGHT[k]
  }
  let totalScore = wsum > 0 && financial !== null ? Math.round(total / wsum) : null

  // 책 70장의 "즉시 위험 신호"(이자보상배율 1배 미만·자본잠식·매출 30% 이상 감소)가 있으면 다른 점수가 좋아도 등급이 오르지 않는다
  const critical: string[] = []
  const rowOf = (k: string) => ratios.find((x) => x.key === k)
  if (rowOf('impair')?.status === 'bad') critical.push('자본잠식')
  if (rowOf('icr')?.status === 'bad') critical.push('이자보상배율 1배 미만')
  const sg = rowOf('salesGrowth')
  if (sg && sg.value !== null && sg.value <= -30) critical.push('매출 30% 이상 감소')
  let capNote: string | null = null
  if (totalScore !== null && critical.length > 0) {
    const cap = critical.length >= 2 ? 44 : 59
    if (totalScore > cap) {
      totalScore = cap
      capNote = `즉시 위험 신호(${critical.join('·')})가 있어 점수 상한 ${cap}점을 적용했습니다. 이 신호를 해소해야 다른 개선이 등급에 반영됩니다.`
    } else capNote = `즉시 위험 신호(${critical.join('·')})가 있습니다. 먼저 해소하세요.`
  }

  let band: CreditResult['band']
  if (totalScore === null || usable.length < 3) {
    band = { key: 'unknown', label: '판정 보류', text: '재무 자료(최소 매출·영업이익·자산·부채·자기자본 등)와 비재무 문항을 입력하면 등급 준비도를 계산합니다.' }
  } else if (totalScore >= 80) band = { key: 'high', label: '우량권 준비도', text: 'BBB 이상을 기대할 수 있는 수준으로 추정됩니다(참고용).' }
  else if (totalScore >= 65) band = { key: 'mid', label: '보통권(BB 전후)', text: '정책자금 기본 접근선인 BB 전후로 추정됩니다. 감점 요인을 정리하면 BBB를 노릴 수 있습니다(참고용).' }
  else if (totalScore >= 45) band = { key: 'low', label: '개선 필요(B~BB 경계)', text: '감점 요인이 많아 B~BB 경계로 추정됩니다. 즉시·3개월 과제부터 정리하세요(참고용).' }
  else band = { key: 'weak', label: '취약(B 이하 우려)', text: '핵심 위험 항목이 겹쳐 B 이하가 우려됩니다. 즉시 위험 항목을 먼저 해소하세요(참고용).' }

  const cur = str(a['CRD-001'])
  const goal = str(a['CRD-002'])
  let goalGap = ''
  if (cur && goal) goalGap = `현재 ${cur} → 목표 ${goal}. 비재무(사업현황서·대표 신용)는 비교적 빠르게, 재무는 가결산으로 0~6개월, 기술은 벤처(약 60일)·연구전담부서(약 15일)로 단기 보강할 수 있습니다.`
  return { ratios, findings, scores: { financial, nonfinancial, tech, total: totalScore }, band, targets: improvementTargets(inputs), goalGap, usableRatios: usable.length, capNote }
}

const str = (v: Answer | undefined) => (typeof v === 'string' ? v : '')

export function decideCreditVerdict(r: CreditResult): { level: 'incomplete' | 'good' | 'fix' | 'urgent'; title: string; text: string } {
  if (r.band.key === 'unknown') return { level: 'incomplete', title: '등급 준비도 판정 보류', text: r.band.text }
  const reds = r.findings.filter((f) => f.item.signal === 'red').length
  if (r.band.key === 'weak' || reds >= 2) return { level: 'urgent', title: `즉시 개선 필요 · ${r.band.label}`, text: `등급 준비도 ${r.scores.total}점. 즉시 위험 ${reds}건을 먼저 해소하고 가결산으로 재무비율을 개선하세요. ${r.band.text}` }
  if (r.band.key === 'low' || reds === 1 || r.band.key === 'mid') return { level: 'fix', title: `개선 여지 있음 · ${r.band.label}`, text: `등급 준비도 ${r.scores.total}점. ${r.band.text}` }
  return { level: 'good', title: `양호 · ${r.band.label}`, text: `등급 준비도 ${r.scores.total}점. ${r.band.text}` }
}

/** 신용평가회사가 중점적으로 보는 것(보고서 고정 안내) */
export const RATING_FOCUS: { title: string; items: string[] }[] = [
  { title: '재무 (약 70%)', items: ['현금흐름·이자보상배율(1배 미만은 즉시 위험)', '매출액증가율(부가세 신고액과 일치해야 인정)과 영업이익률(업종 평균·전년 대비 하락폭)', '부채비율·차입금의존도·유동비율·자기자본비율(업종 평균 기준)', '재무제표 5대 위험 항목: 가지급금·가수금·개발비 과대계상·자본잠식·영업이익 적자', '동종·동규모 대비 상·하위 0~5% 비용 항목(경고 표시)'] },
  { title: '비재무 (약 25%)', items: ['대표자 신용(연체·카드 기한)·대표 자산·대표 이력', '주주현황·특수관계 거래, 주요 매출처·매입처 다양성과 신용', '사업장(자가·공단·임차), 노사 안정성', '추정재무제표와 비전의 현실성(사업현황서 작성 수준)'] },
  { title: '기술 (약 5%)', items: ['기술평가(TCB) 등급, 특허·실용신안', '벤처기업(확인 약 60일)·기업부설연구소(인정 약 15일)·이노비즈·직무발명보상'] },
]

/** 같은 숫자라도 기관마다 다르게 보는 이유(책 15부) */
export const SAME_NUMBER_NOTES = [
  '부채비율 110%라도 신용평가(건설업 업종평균 64% 기준)는 감점, 은행 여신(200% 기준)은 양호, 중진공 융자제한(건설업 약 369~404%)은 무관입니다.',
  '결산 목적이 다릅니다: 세무조정계산서(세금 신고)는 절세 방향, 재무제표증명원(신평사·은행)은 이익을 남기는 방향 — 가결산으로 두 목적을 조정하세요.',
  '산업분류코드(지원기관)와 업종분류코드(국세청)는 다릅니다. 코드가 어긋나면 업종 평균 비교와 융자제한 기준이 바뀝니다.',
]

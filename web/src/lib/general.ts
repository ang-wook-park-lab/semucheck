import type { Client, Diagnosis, GmArea, GmChecklist, GmItem, RiskLevel, StatusCode } from './types'
import type { Verdict } from './report'

export const STATUS_MARK: Record<StatusCode, string> = { ok: '○', fix: '△', bad: '×', na: '—' }
export const STATUS_LABEL: Record<StatusCode, string> = { ok: '양호', fix: '보완필요', bad: '미흡', na: '해당없음' }
const LEVEL_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

/** 진단 메모에 함께 저장하는 예약 키(항목 id와 겹치지 않는다) */
export const NOTE_DATE = '_date'
export const NOTE_SUMMARY = '_summary'
export const NOTE_NEXT = '_next'

export interface StatusCounts {
  ok: number
  fix: number
  bad: number
  na: number
  unanswered: number
  total: number
}

export interface GmFinding {
  area: GmArea
  item: GmItem
  status: 'fix' | 'bad'
  note?: string
}

export interface AreaSummary {
  area: GmArea
  counts: StatusCounts
}

export interface GeneralReport {
  client: Client
  checklist: GmChecklist
  totals: StatusCounts
  areas: AreaSummary[]
  answeredCount: number
  totalCount: number
  /** 0~100. (양호 + 보완필요×0.5) ÷ (해당없음 제외 응답) */
  managementScore: number | null
  verdict: Verdict
  priorities: GmFinding[]
  findings: GmFinding[]
  unanswered: { area: GmArea; item: GmItem }[]
  summary: string
  nextDate: string
  inspectDate: string
}

export const isStatus = (v: unknown): v is StatusCode => v === 'ok' || v === 'fix' || v === 'bad' || v === 'na'

export function countStatuses(area: GmArea[], answers: Diagnosis['answers']): StatusCounts {
  const c: StatusCounts = { ok: 0, fix: 0, bad: 0, na: 0, unanswered: 0, total: 0 }
  for (const a of area)
    for (const it of a.items) {
      c.total++
      const v = answers[it.id]
      if (isStatus(v)) c[v]++
      else c.unanswered++
    }
  return c
}

export function buildGeneralReport(checklist: GmChecklist, diag: Diagnosis, client: Client): GeneralReport {
  const areas = checklist.areas.map((area) => ({ area, counts: countStatuses([area], diag.answers) }))
  const totals = countStatuses(checklist.areas, diag.answers)
  const answeredCount = totals.total - totals.unanswered

  const findings: GmFinding[] = []
  const unanswered: GeneralReport['unanswered'] = []
  for (const area of checklist.areas)
    for (const item of area.items) {
      const v = diag.answers[item.id]
      if (v === 'fix' || v === 'bad') findings.push({ area, item, status: v, note: diag.notes[item.id] })
      else if (!isStatus(v)) unanswered.push({ area, item })
    }
  // 미흡 → 보완필요, 같으면 위험도(high 먼저), 같으면 책의 영역·항목 순서
  const rank = (f: GmFinding) => (f.status === 'bad' ? 0 : 1)
  findings.sort((a, b) => rank(a) - rank(b) || LEVEL_ORDER[a.item.risk_level] - LEVEL_ORDER[b.item.risk_level])

  const scored = totals.ok + totals.fix + totals.bad
  const managementScore = scored ? Math.round(((totals.ok + totals.fix * 0.5) / scored) * 100) : null
  const progress = totals.total ? answeredCount / totals.total : 0

  let verdict: Verdict
  if (progress < 0.6) {
    verdict = {
      level: 'incomplete',
      title: '점검 미완료',
      text: `전체 ${totals.total}항목 중 ${Math.round(progress * 100)}%만 점검했습니다. 60% 이상 점검해야 판정을 제시합니다. 아래 결과는 점검한 항목 기준입니다.`,
    }
  } else if (findings.some((f) => f.status === 'bad' && f.item.risk_level === 'high')) {
    verdict = { level: 'urgent', title: '즉시 개선 필요', text: '위험도가 높은 항목이 미흡 상태입니다. 개선 우선순위 순서대로 즉시 조치하세요.' }
  } else if (findings.length) {
    verdict = { level: 'fix', title: '보완 필요', text: `미흡 ${totals.bad}건, 보완필요 ${totals.fix}건이 있습니다. 개선 우선순위 순서로 정비하세요.` }
  } else {
    verdict = { level: 'good', title: '양호', text: '점검한 항목에서 미흡·보완필요 항목이 없습니다. 정기 점검을 이어가세요.' }
  }

  return {
    client,
    checklist,
    totals,
    areas,
    answeredCount,
    totalCount: totals.total,
    managementScore,
    verdict,
    priorities: findings.slice(0, 5),
    findings,
    unanswered,
    summary: diag.notes[NOTE_SUMMARY] ?? '',
    nextDate: diag.notes[NOTE_NEXT] ?? '',
    inspectDate: diag.notes[NOTE_DATE] ?? '',
  }
}

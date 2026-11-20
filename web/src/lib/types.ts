export type Signal = 'red' | 'yellow' | 'blue'
export type RiskLevel = 'high' | 'medium' | 'low'
export type AnswerType = 'yes_no' | 'number' | 'single_choice' | 'multi_choice' | 'text' | 'file'
export type Answer = string | number

export interface ChecklistItem {
  id: string
  domain: string
  category: string
  question: string
  help?: string
  answer_type: AnswerType
  options?: string[]
  applies_if?: string
  risk_rule: string
  signal?: Signal // 샘플 문항(노무)에는 없을 수 있음 → 노랑으로 처리
  risk_level: RiskLevel
  score_weight?: number
  legal_basis?: string
  consequence?: string
  recommendation: string
  source?: string
  verified_at?: string
}

export interface ClientProfile {
  business_type: '법인' | '개인'
  business_age: number
  employees: number
  bookkeeping: '복식부기' | '간편장부'
  has_research_lab: boolean
  has_venture: boolean
  planning_job_invention: boolean
  industry: string
}

export interface Client {
  id: string
  name: string
  profile: ClientProfile
  createdAt: string
}

export interface Diagnosis {
  id: string
  clientId: string
  domain: string
  answers: Record<string, Answer>
  notes: Record<string, string>
  status: 'in_progress' | 'completed'
  createdAt: string
  updatedAt: string
}

// ---------- 상태 점검표(○△×—) 방식: 법인 일반관리 64항목 ----------
export type StatusCode = 'ok' | 'fix' | 'bad' | 'na'

export interface GmItem {
  id: string
  text: string
  check: string
  recommendation: string
  risk_level: RiskLevel
  legal_basis?: string
  ocr_uncertain?: boolean
  verified_at?: string
}

export interface GmArea {
  id: string
  name: string
  key_point: string
  items: GmItem[]
}

export interface GmChecklist {
  id: string
  domain: string
  title: string
  subtitle?: string
  source: string
  note?: string
  status_options: { code: StatusCode; label: string; mark: string }[]
  areas: GmArea[]
}

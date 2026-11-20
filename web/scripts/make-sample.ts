// 샘플 데이터 생성기: 체크리스트와 규칙 해석기로 샘플 고객사·진단의 응답을 계산해 deploy/sample-data.json 에 쓴다.
//   실행: cd web && npx vite-node scripts/make-sample.ts
// 체크리스트(문항 ID·선택지)가 바뀌면 다시 실행해 커밋한다(web/src/lib/sample.test.ts 가 어긋남을 알려 준다).
import { writeFileSync } from 'node:fs'
import { getDomain, itemsForMode, statusForMode } from '../src/lib/checklists'
import { buildEnv, isApplicable } from '../src/lib/report'
import { firstWhere } from '../src/lib/testutil'
import type { Answer, ClientProfile, DiagnosisMode } from '../src/lib/types'

type Override = { match: string; answer: Answer; note?: string }
interface DiagSpec {
  domain: string
  mode: DiagnosisMode
  status: 'completed' | 'in_progress'
  daysAgo: number
  /** 진행 중이면 앞에서부터 이 비율만 응답한다 */
  answeredFraction?: number
  overrides: Override[]
}
interface ClientSpec {
  key: string
  name: string
  profile: ClientProfile
  diagnoses: DiagSpec[]
}

const profile = (p: Partial<ClientProfile>): ClientProfile => ({
  business_type: '법인', business_age: 3, employees: 10, bookkeeping: '복식부기', has_research_lab: false, has_venture: false, planning_job_invention: false, industry: '제조업(C)', ...p,
})

const CLIENTS: ClientSpec[] = [
  {
    key: 'hanbit',
    name: '[샘플] (주)한빛정밀',
    profile: profile({ industry: '제조업(C)', business_age: 6, employees: 85, has_research_lab: true, has_venture: true, planning_job_invention: true }),
    diagnoses: [
      {
        domain: 'policy-fund', mode: 'full', status: 'completed', daysAgo: 3,
        overrides: [
          { match: '재무제표에 가지급금 잔액', answer: '예', note: '대표 가지급금 약 1.2억(샘플). 급여·배당 정리 계획 수립 필요' },
          { match: '부채비율(총부채', answer: 230, note: '결산 전 증자·장기차입 전환 검토' },
          { match: '기업 신용등급은', answer: 'BB+' },
          { match: '대표자 개인 신용등급', answer: 3 },
          { match: '전년 대비 매출이 감소', answer: '증가' },
          { match: '기업부설연구소', answer: '기업부설연구소' },
          { match: '벤처기업 확인', answer: '예' },
          { match: '이노비즈 또는 메인비즈', answer: '이노비즈' },
          { match: '등록 특허는 몇 건', answer: 2 },
        ],
      },
      {
        domain: 'labor', mode: 'full', status: 'completed', daysAgo: 5,
        overrides: [
          { match: '1주 52시간', answer: '예', note: '생산팀 2명이 최근 3개월 중 4주 초과(샘플). 인력 재배치 필요' },
          { match: '포괄임금제(고정 연장근로수당 포함 임금)를 운영', answer: '예' },
          { match: '포괄임금제 사용 시 실제', answer: '아니오', note: '약정 20시간 초과분 별도 정산 안 함(샘플)' },
          { match: '운영 중인 근로시간 제도', answer: '선택적 근로시간제' },
          { match: '연차 사용 촉진은 어떻게', answer: '구두·메신저로만 촉진함' },
          { match: '최근 또는 현재 취업규칙을 개정', answer: '유리하거나 중립적인 변경만 있음' },
        ],
      },
      {
        domain: 'accounting', mode: 'quick', status: 'completed', daysAgo: 8,
        overrides: [
          { match: '재무제표에 가지급금 잔액', answer: '예' },
          { match: '법정 인정이자', answer: '아니오', note: '인정이자 계산·세무조정 누락(샘플)' },
          { match: '부채비율(총부채', answer: 230 },
        ],
      },
      {
        domain: 'corporate-general', mode: 'full', status: 'completed', daysAgo: 10,
        overrides: [
          { match: '정관 최신화', answer: 'fix', note: '임원퇴직금 규정 정관 반영 필요(샘플)' },
          { match: '의사록 작성', answer: 'fix' },
          { match: '세무조사 대비', answer: 'bad', note: '증빙·가지급금 내역 정리 안 됨(샘플)' },
          { match: '교육·훈련 계획', answer: 'fix' },
          { match: '재고 및 구매', answer: 'na' },
        ],
      },
    ],
  },
  {
    key: 'saebom',
    name: '[샘플] 새봄푸드',
    profile: profile({ industry: '숙박·음식점업(I)', business_age: 2, employees: 4, business_type: '법인' }),
    diagnoses: [
      { domain: 'policy-fund', mode: 'quick', status: 'in_progress', daysAgo: 1, answeredFraction: 0.6, overrides: [{ match: '4대보험료 체납', answer: '예' }, { match: '업종 대분류', answer: '숙박·음식점업(I)' }] },
      {
        domain: 'labor', mode: 'quick', status: 'completed', daysAgo: 4,
        overrides: [{ match: '근로계약서를 작성해 교부', answer: '아니오', note: '아르바이트 2명 서면 계약 없음(샘플)' }, { match: '최저임금 이상', answer: '예' }],
      },
    ],
  },
  {
    key: 'nuri',
    name: '[샘플] (주)누리소프트',
    profile: profile({ industry: '정보통신업(J)', business_age: 9, employees: 32, has_venture: true }),
    diagnoses: [
      {
        domain: 'policy-fund', mode: 'full', status: 'completed', daysAgo: 6,
        overrides: [
          { match: '기업 신용등급은', answer: 'BB' }, { match: '대표자 개인 신용등급', answer: 2 },
          { match: '기업부설연구소', answer: '없음', note: '연구전담부서 설립 시 가점·세액공제 가능(샘플)' },
          { match: '벤처기업 확인', answer: '예' }, { match: '등록 특허는 몇 건', answer: 0 }, { match: '전년 대비 매출이 감소', answer: '증가' },
        ],
      },
      { domain: 'labor', mode: 'full', status: 'in_progress', daysAgo: 2, answeredFraction: 0.4, overrides: [{ match: '근로계약서를 작성해 교부', answer: '예' }] },
      { domain: 'corporate-general', mode: 'quick', status: 'completed', daysAgo: 7, overrides: [{ match: '법인세 신고', answer: 'ok' }, { match: '근로계약서 작성', answer: 'fix' }] },
    ],
  },
]

function build(c: ClientSpec, d: DiagSpec) {
  const dom = getDomain(d.domain)!
  const answers: Record<string, Answer> = {}
  const notes: Record<string, string> = {}
  const find = (text: string, q: string) => text.includes(q)
  if (dom.kind === 'status') {
    const g = statusForMode(dom.status!, d.mode)
    const items = g.areas.flatMap((a) => a.items)
    const limit = d.answeredFraction ? Math.round(items.length * d.answeredFraction) : items.length
    items.slice(0, limit).forEach((it) => {
      const ov = d.overrides.find((o) => find(it.text, o.match))
      answers[it.id] = (ov?.answer as string) ?? 'ok'
      if (ov?.note) notes[it.id] = ov.note
    })
    if (d.status === 'completed') {
      notes['_summary'] = '샘플 데이터입니다. 실제 고객사 정보가 아닙니다.'
      notes['_date'] = new Date(Date.now() - d.daysAgo * 86400_000).toISOString().slice(0, 10)
    }
  } else {
    const items = itemsForMode(dom, d.mode)
    const limit = d.answeredFraction ? Math.round(items.length * d.answeredFraction) : items.length
    for (const it of items.slice(0, limit)) {
      if (!isApplicable(it, buildEnv(c.profile, answers))) continue
      const ov = d.overrides.find((o) => find(it.question, o.match))
      let v: Answer | undefined = ov?.answer
      if (v !== undefined) {
        // 규칙의 키워드가 엉뚱한 문항에 걸려 유형이 맞지 않는 값이 들어가는 것을 막는다
        const okType = it.answer_type === 'yes_no' ? v === '예' || v === '아니오' : it.answer_type === 'number' ? typeof v === 'number' : Boolean(it.options?.includes(v as string))
        if (!okType) throw new Error(`샘플 규칙 '${ov!.match}' 이(가) ${it.id}(${it.answer_type}) 에 유형이 맞지 않는 값(${v}) 을 넣었습니다.`)
      }
      if (v === undefined) v = firstWhere(it, false)
      if (v === undefined) continue
      answers[it.id] = v
      if (ov?.note) notes[it.id] = ov.note
    }
  }
  return { domain: d.domain, mode: d.mode, status: d.status, daysAgo: d.daysAgo, answers, notes }
}

const out = {
  version: 1,
  note: '샘플 데이터(가상). web/scripts/make-sample.ts 로 생성합니다.',
  clients: CLIENTS.map((c) => ({ key: c.key, name: c.name, profile: c.profile, diagnoses: c.diagnoses.map((d) => build(c, d)) })),
  accounts: [
    { username: 'sample-consultant', name: '샘플 컨설턴트', role: 'consultant', ownKeys: ['saebom'] },
    { username: 'sample-client', name: '샘플 고객(한빛정밀)', role: 'client', clientKey: 'hanbit' },
  ],
}
writeFileSync(new URL('../../deploy/sample-data.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
const n = out.clients.reduce((s, c) => s + c.diagnoses.length, 0)
console.log(`샘플 고객사 ${out.clients.length}곳, 진단 ${n}건 생성`)
for (const c of out.clients) for (const d of c.diagnoses) console.log(`  ${c.name} · ${d.domain} · ${d.mode} · ${d.status} · 응답 ${Object.keys(d.answers).length}`)

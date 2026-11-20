import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getDomain, itemsForMode, statusForMode } from './checklists'
import { buildGeneralReport } from './general'
import { buildReport } from './report'
import type { Client, ClientProfile, Diagnosis, DiagnosisMode } from './types'

// 샘플 데이터(deploy/sample-data.json)가 지금 체크리스트와 맞는지 확인한다.
// 어긋나면 `cd web && npx vite-node scripts/make-sample.ts` 로 다시 생성해 커밋한다.
interface SampleDiag { domain: string; mode: DiagnosisMode; status: 'completed' | 'in_progress'; daysAgo: number; answers: Record<string, string | number>; notes: Record<string, string> }
interface SampleData {
  clients: { key: string; name: string; profile: ClientProfile; diagnoses: SampleDiag[] }[]
  accounts: { username: string; name: string; role: string; clientKey?: string; ownKeys?: string[] }[]
}
const data = JSON.parse(readFileSync(new URL('../../../deploy/sample-data.json', import.meta.url), 'utf8')) as SampleData

describe('샘플 데이터', () => {
  it('고객사 3곳·진단 9건, 이름은 [샘플]로 시작', () => {
    expect(data.clients).toHaveLength(3)
    expect(data.clients.flatMap((c) => c.diagnoses)).toHaveLength(9)
    expect(data.clients.every((c) => c.name.startsWith('[샘플]'))).toBe(true)
  })
  it('4개 분야와 전체·간단 진단, 완료·진행 중이 모두 들어 있다', () => {
    const all = data.clients.flatMap((c) => c.diagnoses)
    expect([...new Set(all.map((d) => d.domain))].sort()).toEqual(['accounting', 'corporate-general', 'labor', 'policy-fund'])
    expect([...new Set(all.map((d) => d.mode))].sort()).toEqual(['full', 'quick'])
    expect([...new Set(all.map((d) => d.status))].sort()).toEqual(['completed', 'in_progress'])
  })

  for (const c of data.clients)
    for (const d of c.diagnoses) {
      it(`${c.name} · ${d.domain} · ${d.mode}: 응답이 현재 체크리스트와 맞는다`, () => {
        const dom = getDomain(d.domain)!
        expect(dom, d.domain).toBeTruthy()
        if (d.mode === 'quick') expect(dom.quickCount).toBeGreaterThan(0)
        if (dom.kind === 'status') {
          const ids = new Set(statusForMode(dom.status!, d.mode).areas.flatMap((a) => a.items.map((i) => i.id)))
          for (const [id, v] of Object.entries(d.answers)) {
            expect(ids.has(id), `${id} 는 ${d.mode} 점검표에 없음`).toBe(true)
            expect(['ok', 'fix', 'bad', 'na']).toContain(v)
          }
        } else {
          const byId = new Map(itemsForMode(dom, d.mode).map((i) => [i.id, i]))
          for (const [id, v] of Object.entries(d.answers)) {
            const it = byId.get(id)
            expect(it, `${id} 는 ${d.mode} 문항에 없음`).toBeTruthy()
            if (it!.answer_type === 'yes_no') expect(['예', '아니오']).toContain(v)
            else if (it!.answer_type === 'number') expect(typeof v).toBe('number')
            else expect(it!.options).toContain(v)
          }
        }
        for (const id of Object.keys(d.notes)) expect(id.startsWith('_') || id in d.answers).toBe(true)
      })
      if (d.status === 'completed') {
        it(`${c.name} · ${d.domain}: 완료된 진단은 판정을 낼 수 있다(응답 60% 이상)`, () => {
          const dom = getDomain(d.domain)!
          const client: Client = { id: 'c', name: c.name, profile: c.profile, createdAt: '' }
          const diag: Diagnosis = { id: 'd', clientId: 'c', domain: d.domain, answers: d.answers, notes: d.notes, status: 'completed', mode: d.mode, createdAt: '', updatedAt: '' }
          const level = dom.kind === 'status' ? buildGeneralReport(statusForMode(dom.status!, d.mode), diag, client).verdict.level : buildReport(itemsForMode(dom, d.mode), diag, client).verdict.level
          expect(level).not.toBe('incomplete')
        })
      }
    }

  it('보고서에 위험·보완 항목이 나오는 진단이 있어 화면 확인에 도움이 된다', () => {
    let withFindings = 0
    for (const c of data.clients)
      for (const d of c.diagnoses.filter((x) => x.status === 'completed')) {
        const dom = getDomain(d.domain)!
        const client: Client = { id: 'c', name: c.name, profile: c.profile, createdAt: '' }
        const diag: Diagnosis = { id: 'd', clientId: 'c', domain: d.domain, answers: d.answers, notes: d.notes, status: 'completed', mode: d.mode, createdAt: '', updatedAt: '' }
        const n = dom.kind === 'status' ? buildGeneralReport(statusForMode(dom.status!, d.mode), diag, client).findings.length : (() => { const r = buildReport(itemsForMode(dom, d.mode), diag, client); return r.reds.length + r.yellows.length })()
        if (n > 0) withFindings++
      }
    expect(withFindings).toBeGreaterThanOrEqual(5)
  })

  it('샘플 계정은 컨설턴트 1명(새봄푸드 담당)과 고객 1명(한빛정밀 연결)', () => {
    expect(data.accounts.map((a) => a.role).sort()).toEqual(['client', 'consultant'])
    const keys = new Set(data.clients.map((c) => c.key))
    for (const a of data.accounts) {
      if (a.clientKey) expect(keys.has(a.clientKey)).toBe(true)
      for (const k of a.ownKeys ?? []) expect(keys.has(k)).toBe(true)
    }
    expect(data.accounts.every((a) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(a.username))).toBe(true)
    expect(JSON.stringify(data.accounts)).not.toMatch(/password/i) // 비밀번호는 파일에 두지 않는다
  })
})

import { describe, expect, it } from 'vitest'
import writeXlsxFile from 'write-excel-file/universal'
import readXlsxFile from 'read-excel-file/universal'
import { domains, getDomain } from './checklists'
import {
  exportChecklistXlsx, exportClientsXlsx, exportDiagnosisXlsx, exportGeneralReportXlsx, exportRiskReportXlsx, MAX_FILE_BYTES,
  parseChecklistXlsx, parseClientsXlsx, parseDiagnosisXlsx, type OwnerRef,
} from './excel'
import { buildGeneralReport } from './general'
import { buildReport } from './report'
import { safeAnswers } from './testutil'
import { EMPTY_PROFILE } from '../components/ClientForm'
import type { Client, Diagnosis } from './types'

type Rows = unknown[][]
const sheetsOf = async (b: Blob) => (await readXlsxFile(await b.arrayBuffer() as never)) as unknown as { sheet: string; data: Rows }[]

/** 엑셀 파일을 읽어 고친 뒤 다시 엑셀로 만든다(사용자가 엑셀에서 수정하는 것을 흉내) */
async function tamper(b: Blob, sheet: string, edit: (rows: Rows) => void): Promise<Blob> {
  const sheets = await sheetsOf(b)
  const target = sheets.find((s) => s.sheet === sheet)!
  edit(target.data)
  const data = sheets.map((s) => ({
    sheet: s.sheet,
    data: s.data.map((r) => r.map((v) => (v === null || v === undefined ? null : typeof v === 'number' ? { value: v, type: Number } : { value: String(v) }))),
  }))
  return writeXlsxFile(data as never, {} as never).toBlob()
}
const col = (rows: Rows, name: string) => rows[0].indexOf(name)

const client = (over: Partial<Client> = {}): Client => ({ id: crypto.randomUUID(), name: '(주)엑셀', profile: { ...EMPTY_PROFILE }, createdAt: '2026-01-01T00:00:00Z', ...over })
const diagOf = (domainKey: string, over: Partial<Diagnosis> = {}): Diagnosis => ({
  id: crypto.randomUUID(), clientId: 'c', domain: domainKey, answers: {}, notes: {}, status: 'in_progress', createdAt: '', updatedAt: '', ...over,
})

describe('체크리스트 엑셀', () => {
  for (const d of domains.filter((x) => x.ready)) {
    it(`${d.label}: 내려받은 파일을 그대로 올리면 변경 0건`, async () => {
      const blob = await exportChecklistXlsx(d)
      const r = await parseChecklistXlsx(d, blob)
      expect(r.errors).toEqual([])
      expect(r.summary).toMatchObject({ added: 0, changed: 0, removed: 0, unchanged: d.count, total: d.count })
    })
  }

  it('문항을 고치면 변경 1건, 지우면 삭제 1건, 새 행은 추가 1건', async () => {
    const d = getDomain('labor')!
    const blob = await exportChecklistXlsx(d)
    const edited = await tamper(blob, '체크리스트', (rows) => {
      rows[1][col(rows, '개선권고')] = '수정된 권고 문구'
      rows.splice(2, 1) // 두 번째 문항 삭제
      const added = [...rows[1]]
      added[col(rows, '문항ID')] = 'LAB-900'
      added[col(rows, '질문')] = '새로 추가한 문항입니까?'
      rows.push(added)
    })
    const r = await parseChecklistXlsx(d, edited)
    expect(r.errors).toEqual([])
    expect(r.summary).toMatchObject({ added: 1, changed: 1, removed: 1 })
  })

  it('간단진단(Y) 표시와 선택지·확인일이 그대로 보존된다', async () => {
    const d = getDomain('policy-fund')!
    const r = await parseChecklistXlsx(d, await exportChecklistXlsx(d))
    const items = r.data as typeof d.items
    expect(items.filter((i) => i.quick).length).toBe(d.quickCount)
    const choice = items.find((i) => i.id === 'FUND-016')!
    expect(choice.options).toEqual(d.items.find((i) => i.id === 'FUND-016')!.options)
  })

  it('잘못된 위험규칙·신호·중복 ID·알 수 없는 조건 변수는 올리지 못한다', async () => {
    const d = getDomain('labor')!
    const blob = await exportChecklistXlsx(d)
    const bad = await tamper(blob, '체크리스트', (rows) => {
      rows[1][col(rows, '위험규칙')] = "answer == " // 문법 오류
      rows[2][col(rows, '신호')] = 'purple'
      rows[3][col(rows, '문항ID')] = rows[4][col(rows, '문항ID')] // 중복
      rows[5][col(rows, '적용조건')] = 'unknown_var == 1'
    })
    const r = await parseChecklistXlsx(d, bad)
    const msg = r.errors.join('\n')
    expect(r.data).toBeUndefined()
    expect(msg).toContain('조건식을 해석할 수 없습니다')
    expect(msg).toContain('신호는 red')
    expect(msg).toContain('중복')
    expect(msg).toContain('알 수 없는 변수')
  })

  it('선택형 위험규칙의 값이 선택지에 없으면 올리지 못한다', async () => {
    const d = getDomain('policy-fund')!
    const bad = await tamper(await exportChecklistXlsx(d), '체크리스트', (rows) => {
      const i = rows.findIndex((r) => r[0] === 'FUND-016')
      rows[i][col(rows, '위험규칙')] = "answer in ['없는선택지']"
    })
    expect((await parseChecklistXlsx(d, bad)).errors.join()).toContain('선택지에 없습니다')
  })

  it('간단진단 문항이 참조하는 앞 질문이 간단진단에 없으면 알려 준다', async () => {
    const d = getDomain('labor')!
    const bad = await tamper(await exportChecklistXlsx(d), '체크리스트', (rows) => {
      const qi = col(rows, '간단진단')
      const gate = rows.find((r) => r[0] === 'LAB-065')!
      gate[qi] = null // 게이트의 간단진단 표시를 지운다
    })
    expect((await parseChecklistXlsx(d, bad)).errors.join()).toMatch(/LAB-065.*간단진단/)
  })

  it('머리글이 바뀐 파일은 필수 열 오류', async () => {
    const d = getDomain('labor')!
    const bad = await tamper(await exportChecklistXlsx(d), '체크리스트', (rows) => {
      rows[0][col(rows, '질문')] = '문제'
    })
    expect((await parseChecklistXlsx(d, bad)).errors.join()).toContain('필수 열이 없습니다')
  })

  it('수식처럼 보이는 문구도 값(문자열)으로만 다룬다', async () => {
    const d = getDomain('labor')!
    const edited = await tamper(await exportChecklistXlsx(d), '체크리스트', (rows) => {
      rows[1][col(rows, '개선권고')] = '=HYPERLINK("http://evil","x")'
    })
    const r = await parseChecklistXlsx(d, edited)
    expect(r.errors).toEqual([])
    expect((r.data as typeof d.items)[0].recommendation).toBe('=HYPERLINK("http://evil","x")')
  })

  it('법인 일반관리 점검표: 영역 순서와 항목이 보존된다', async () => {
    const d = getDomain('corporate-general')!
    const r = await parseChecklistXlsx(d, await exportChecklistXlsx(d))
    const g = r.data as NonNullable<typeof d.status>
    expect(g.areas.map((a) => a.id)).toEqual(d.status!.areas.map((a) => a.id))
    expect(g.areas.flatMap((a) => a.items).length).toBe(64)
    expect(r.summary).toMatchObject({ added: 0, changed: 0, removed: 0 })
  })

  it('xlsx 가 아닌 파일·너무 큰 파일은 거부', async () => {
    const d = getDomain('labor')!
    await expect(parseChecklistXlsx(d, new Blob(['이건 엑셀이 아닙니다']))).rejects.toThrow(/xlsx/)
    await expect(parseChecklistXlsx(d, new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]))).rejects.toThrow(/너무 큽니다/)
  })
})

describe('고객사 엑셀', () => {
  const owners: OwnerRef[] = [{ id: crypto.randomUUID(), username: 'kim', name: '김컨설턴트' }]

  it('내려받아 다시 올리면 같은 값(ID 포함)', async () => {
    const c = client({ profile: { ...EMPTY_PROFILE, employees: 80, business_age: 6, has_research_lab: true }, ownerId: owners[0].id })
    const r = await parseClientsXlsx(await exportClientsXlsx([c], { includeOwner: true, owners }), { isAdmin: true, owners })
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ id: c.id, name: c.name, ownerId: owners[0].id })
    expect(r.rows[0].profile).toMatchObject({ employees: 80, business_age: 6, has_research_lab: true, business_type: '법인' })
  })

  it('빈 양식(예시 1행)은 ID 없이 새 고객사로 읽힌다', async () => {
    const r = await parseClientsXlsx(await exportClientsXlsx([], { includeOwner: false, template: true }), { isAdmin: false })
    expect(r.errors).toEqual([])
    expect(r.rows[0].id).toBeUndefined()
    expect(r.rows[0].name).toBe('(주)예시상사')
  })

  it('잘못된 값은 행 번호와 함께 모두 알려 준다', async () => {
    const blob = await exportClientsXlsx([client(), client({ name: '둘째' })], { includeOwner: false })
    const bad = await tamper(blob, '고객사', (rows) => {
      rows[1][col(rows, '사업자형태')] = '협동조합'
      rows[1][col(rows, '업력(년)')] = '많음'
      rows[2][col(rows, '고객사명')] = ''
      rows[2][col(rows, '연구소(Y/N)')] = '모름'
    })
    const r = await parseClientsXlsx(bad, { isAdmin: false })
    const msg = r.errors.join('\n')
    expect(r.rows).toHaveLength(0)
    expect(msg).toContain('2행: 사업자형태')
    expect(msg).toContain('2행: 업력')
    expect(msg).toContain('3행: 고객사명')
    expect(msg).toContain('3행: 연구소')
  })

  it('컨설턴트는 담당자 열을 쓸 수 없고, 관리자는 없는 아이디를 쓸 수 없다', async () => {
    const withOwner = await tamper(await exportClientsXlsx([client()], { includeOwner: true, owners }), '고객사', (rows) => {
      rows[1][col(rows, '담당컨설턴트(아이디)')] = 'kim'
    })
    expect((await parseClientsXlsx(withOwner, { isAdmin: false })).errors.join()).toContain('관리자만')
    const unknown = await tamper(await exportClientsXlsx([client()], { includeOwner: true, owners }), '고객사', (rows) => {
      rows[1][col(rows, '담당컨설턴트(아이디)')] = 'nobody'
    })
    expect((await parseClientsXlsx(unknown, { isAdmin: true, owners })).errors.join()).toContain('찾을 수 없습니다')
  })

  it('고객사ID 가 파일 안에서 중복되면 오류', async () => {
    const a = client()
    const r = await parseClientsXlsx(await exportClientsXlsx([a, { ...a, name: '복사본' }], { includeOwner: false }), { isAdmin: false })
    expect(r.errors.join()).toContain('중복')
  })
})

describe('진단 응답 양식 엑셀', () => {
  const policy = getDomain('policy-fund')!

  it('내려받은 양식을 그대로 올리면 변경 0건, 간단진단은 간단 문항만 담긴다', async () => {
    const full = diagOf('policy-fund', { answers: { 'FUND-001': '예', 'FUND-018': 250, 'FUND-016': 'BB' }, notes: { 'FUND-001': '메모' } })
    const blob = await exportDiagnosisXlsx(policy, full)
    expect((await sheetsOf(blob))[0].data.length - 1).toBe(policy.count)
    const r = await parseDiagnosisXlsx(policy, full, blob)
    expect(r.errors).toEqual([])
    expect(r.changes).toBe(0)
    const quick = diagOf('policy-fund', { mode: 'quick' })
    expect((await sheetsOf(await exportDiagnosisXlsx(policy, quick)))[0].data.length - 1).toBe(policy.quickCount)
  })

  it('응답을 채워 올리면 타입에 맞게 반영된다(숫자는 숫자, 선택형은 선택지)', async () => {
    const cur = diagOf('policy-fund')
    const filled = await tamper(await exportDiagnosisXlsx(policy, cur), '응답', (rows) => {
      const set = (id: string, v: unknown) => { rows.find((r) => r[0] === id)![col(rows, '응답(입력)')] = v }
      set('FUND-001', '예')
      set('FUND-002', '아니오')
      set('FUND-018', 250)
      set('FUND-016', 'BB')
      rows.find((r) => r[0] === 'FUND-001')![col(rows, '메모')] = '증빙 확인'
    })
    const r = await parseDiagnosisXlsx(policy, cur, filled)
    expect(r.errors).toEqual([])
    expect(r.answers).toMatchObject({ 'FUND-001': '예', 'FUND-002': '아니오', 'FUND-018': 250, 'FUND-016': 'BB' })
    expect(r.notes['FUND-001']).toBe('증빙 확인')
    expect(r.changes).toBe(5)
  })

  it('잘못된 응답은 행 번호·문항ID와 함께 거부하고 아무것도 바꾸지 않는다', async () => {
    const cur = diagOf('policy-fund', { answers: { 'FUND-001': '예' } })
    const bad = await tamper(await exportDiagnosisXlsx(policy, cur), '응답', (rows) => {
      const set = (id: string, v: unknown) => { rows.find((r) => r[0] === id)![col(rows, '응답(입력)')] = v }
      set('FUND-002', '글쎄')
      set('FUND-018', '많음')
      set('FUND-016', '없는등급')
    })
    const r = await parseDiagnosisXlsx(policy, cur, bad)
    const msg = r.errors.join('\n')
    expect(msg).toContain('FUND-002')
    expect(msg).toContain('FUND-018')
    expect(msg).toContain('FUND-016')
    expect(r.answers).toEqual(cur.answers)
    expect(r.changes).toBe(0)
  })

  it('응답을 비우면 기존 응답이 지워진다', async () => {
    const cur = diagOf('policy-fund', { answers: { 'FUND-001': '예', 'FUND-002': '예' } })
    const cleared = await tamper(await exportDiagnosisXlsx(policy, cur), '응답', (rows) => {
      rows.find((r) => r[0] === 'FUND-001')![col(rows, '응답(입력)')] = null
    })
    const r = await parseDiagnosisXlsx(policy, cur, cleared)
    expect(r.answers['FUND-001']).toBeUndefined()
    expect(r.answers['FUND-002']).toBe('예')
  })

  it('다른 진단(다른 분야)의 양식을 올리면 맞는 행이 없다고 알려 준다', async () => {
    const labor = getDomain('labor')!
    const other = await exportDiagnosisXlsx(labor, diagOf('labor'))
    const r = await parseDiagnosisXlsx(policy, diagOf('policy-fund'), other)
    expect(r.errors.join()).toContain('맞는 행이 없습니다')
  })

  it('법인 일반관리: 상태(한글·기호)와 종합 시트를 읽는다', async () => {
    const g = getDomain('corporate-general')!
    const cur = diagOf('corporate-general')
    const filled = await tamper(await exportDiagnosisXlsx(g, cur), '응답', (rows) => {
      const si = col(rows, '상태(입력)')
      rows[1][si] = '양호'
      rows[2][si] = '△'
      rows[3][si] = '미흡'
      rows[4][si] = '해당없음'
    })
    const withSummary = await tamper(filled, '종합', (rows) => {
      rows[1][1] = '2026-11-20'
      rows[2][1] = '종합 의견'
    })
    const r = await parseDiagnosisXlsx(g, cur, withSummary)
    expect(r.errors).toEqual([])
    expect(Object.values(r.answers)).toEqual(['ok', 'fix', 'bad', 'na'])
    expect(r.notes['_summary']).toBe('종합 의견')
    expect(r.notes['_date']).toBe('2026-11-20')
  })
})

describe('보고서 엑셀', () => {
  it('위험 규칙형 보고서에는 요약·해당 항목·미응답 시트가 있다', async () => {
    const d = getDomain('labor')!
    const c = client({ profile: { ...EMPTY_PROFILE, employees: 80 } })
    const diag = diagOf('labor', { clientId: c.id, answers: { ...safeAnswers(d.items), 'LAB-001': '아니오' } })
    const r = buildReport(d.items, diag, c)
    const sheets = await sheetsOf(await exportRiskReportXlsx(d, c, diag, r))
    expect(sheets.map((s) => s.sheet)).toEqual(['요약', '해당 항목', '미응답'])
    const found = sheets[1].data
    expect(found.some((row) => row[1] === 'LAB-001' && row[0] === '위반 위험')).toBe(true)
    expect(String(sheets[0].data.find((row) => row[0] === '고객사')![1])).toBe('(주)엑셀')
  })

  it('상태 점검표 보고서', async () => {
    const d = getDomain('corporate-general')!
    const c = client()
    const first = d.status!.areas[0].items[0].id
    const diag = diagOf('corporate-general', { clientId: c.id, answers: { [first]: 'bad' } })
    const r = buildGeneralReport(d.status!, diag, c)
    const sheets = await sheetsOf(await exportGeneralReportXlsx(d, c, diag, r))
    expect(sheets.map((s) => s.sheet)).toEqual(['요약', '미흡·보완필요', '미점검'])
    expect(sheets[1].data.some((row) => row[2] === first && row[0] === '미흡')).toBe(true)
  })
})

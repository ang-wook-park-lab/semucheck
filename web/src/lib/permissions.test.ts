import { describe, expect, it } from 'vitest'
import { can, ROLE_LABEL, type Action } from './permissions'
import type { Role } from './types'

const ACTIONS: Action[] = ['manageUsers', 'editChecklists', 'viewChecklists', 'editData', 'importData', 'viewAllData', 'viewReports', 'manageSample']
const allowed = (role: Role) => ACTIONS.filter((a) => can(role, a))

describe('역할별 권한표', () => {
  it('관리자는 모든 작업', () => {
    expect(allowed('admin')).toEqual(ACTIONS)
  })
  it('컨설턴트: 데이터 수정·가져오기·체크리스트 조회·보고서, 사용자 관리·체크리스트 수정·전체 조회는 불가', () => {
    expect(allowed('consultant')).toEqual(['viewChecklists', 'editData', 'importData', 'viewReports'])
    for (const a of ['manageUsers', 'editChecklists', 'viewAllData', 'manageSample'] as Action[]) expect(can('consultant', a)).toBe(false)
  })
  it('고객: 보고서 조회만(읽기 전용)', () => {
    expect(allowed('client')).toEqual(['viewReports'])
  })
  it('역할이 없으면 아무것도 못 한다', () => {
    expect(allowed(undefined as unknown as Role)).toEqual([])
  })
  it('역할 이름', () => {
    expect(ROLE_LABEL).toEqual({ admin: '관리자', consultant: '컨설턴트', client: '고객' })
  })
})

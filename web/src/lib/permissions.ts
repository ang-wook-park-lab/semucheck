import type { Role } from './types'

// 권한은 서버(deploy/api.mjs)가 최종 판단한다. 이 표는 화면에서 메뉴·버튼을 보이거나 숨기기 위한 것이며 서버 규칙과 같아야 한다.
//   관리자     : 모든 데이터 조회·수정, 사용자 관리, 체크리스트 수정·엑셀 업로드, 샘플 데이터 관리
//   컨설턴트   : 자기 담당 고객사·진단만 조회·수정, 체크리스트는 조회·다운로드만
//   고객       : 자기 회사의 완료된 진단 보고서만 조회(읽기 전용)
export const ROLE_LABEL: Record<Role, string> = { admin: '관리자', consultant: '컨설턴트', client: '고객' }

export type Action =
  | 'manageUsers' // 사용자 추가·역할 변경·비활성화
  | 'editChecklists' // 체크리스트 문항 수정, 엑셀 업로드, 원본 복원
  | 'viewChecklists' // 체크리스트 조회·엑셀 다운로드
  | 'editData' // 고객사·진단 작성, 수정, 삭제
  | 'importData' // 고객사·진단 엑셀 업로드
  | 'viewAllData' // 다른 컨설턴트의 고객사·진단 조회
  | 'viewReports' // 진단 보고서 조회·엑셀 내려받기
  | 'manageSample' // 샘플 데이터 넣기·지우기

const TABLE: Record<Role, Action[]> = {
  admin: ['manageUsers', 'editChecklists', 'viewChecklists', 'editData', 'importData', 'viewAllData', 'viewReports', 'manageSample'],
  consultant: ['viewChecklists', 'editData', 'importData', 'viewReports'],
  client: ['viewReports'],
}

export function can(role: Role | undefined, action: Action): boolean {
  return role ? TABLE[role].includes(action) : false
}

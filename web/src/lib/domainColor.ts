// 분야(정책자금·법인 일반관리·회계·창업·노무)마다 고유한 색과 아이콘을 준다.
// 카테고리 색(catColor)·정밀/간단 색(파랑/주황)과 겹치지 않게 차분한 5색(초록·보라·하늘·장미·황금)을 쓴다.
// 색값은 styles.css 의 .dm-<분야키>, 알 수 없는 분야는 기본(남색).
export const domainClass = (key: string): string => `dm dm-${key}`

export const DOMAIN_ICON: Record<string, string> = {
  'policy-fund': 'coin',
  'corporate-general': 'building',
  accounting: 'calc',
  startup: 'rocket',
  credit: 'chart',
  labor: 'people',
}
export const domainIcon = (key: string): string => DOMAIN_ICON[key] ?? 'doc'

/** 휴대폰 카드에 쓰는 한 줄 설명 */
export const DOMAIN_TAGLINE: Record<string, string> = {
  'policy-fund': '정책자금·보증·인증 신청 가능성',
  'corporate-general': '경영·재무·세무·노무 8개 영역 점검',
  accounting: '장부·세무·결산 리스크',
  startup: '창업 해당 여부·청년·과밀억제권역',
  credit: '신평사가 보는 재무·비재무·기술과 등급 개선',
  labor: '취업규칙·근태·징계 노무 리스크',
}

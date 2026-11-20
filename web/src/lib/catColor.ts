// 카테고리마다 구분되는 선명한 색을 배정한다. 분야 안의 카테고리 순서로 고정해서
// 응답에 따라 보이는 카테고리가 바뀌어도 색이 달라지지 않는다. 색은 styles.css 의 .cc0 ~ .cc7.
// 신호등(빨강·노랑·파랑 = 결격·감점·가점)과 헷갈리지 않도록 순수한 빨강은 쓰지 않는다.
export const CAT_COLOR_COUNT = 8

export const catClass = (all: string[], category: string): string => `cc${Math.max(0, all.indexOf(category)) % CAT_COLOR_COUNT}`

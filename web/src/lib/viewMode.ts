// 휴대폰 화면(모바일 버전)과 PC 버전 전환.
//  - 폭 700px 이하이면 "휴대폰 화면"(큰 버튼·하단 탭)으로 보여 준다.
//  - "PC 버전" 을 누르면 브라우저 viewport 를 1100px 로 고정해 PC 화면 그대로 보여 준다(손가락으로 확대 가능).
//    선택은 이 브라우저에 기억되고, "모바일 버전" 으로 되돌릴 수 있다.
import { useEffect, useState } from 'react'

export const PHONE_MAX = 700
const KEY = 'semucheck:view'
export type ViewPref = 'auto' | 'pc'

export function getViewPref(): ViewPref {
  try {
    return localStorage.getItem(KEY) === 'pc' ? 'pc' : 'auto'
  } catch {
    return 'auto'
  }
}

/** 앱이 뜨기 전에 호출한다: PC 버전이면 viewport 를 넓게 잡는다 */
export function applyViewport(pref: ViewPref = getViewPref()) {
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return
  meta.setAttribute('content', pref === 'pc' ? 'width=1100, minimum-scale=0.2, maximum-scale=5, user-scalable=yes' : 'width=device-width, initial-scale=1.0')
}

/** 전환하고 다시 불러온다(viewport 변경을 확실히 반영하려고) */
export function setViewPref(pref: ViewPref) {
  try {
    if (pref === 'pc') localStorage.setItem(KEY, 'pc')
    else localStorage.removeItem(KEY)
  } catch {
    /* 저장소를 못 쓰면 이번 방문에만 적용 */
  }
  applyViewport(pref)
  window.location.reload()
}

const query = `(max-width: ${PHONE_MAX}px)`

/** 지금 휴대폰 폭인지(창 크기가 바뀌면 따라간다) */
export function usePhone(): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [phone, setPhone] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

import type { ReactNode } from 'react'
import type { Signal } from '../lib/types'

const PATHS: Record<string, string> = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  check: 'M9 12l2 2 4-4M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  users: 'M16 11a4 4 0 1 0-8 0M4 20a8 8 0 0 1 16 0',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  print: 'M7 9V3h10v6M7 17H4v-6h16v6h-3M7 14h10v7H7z',
  save: 'M5 3h12l4 4v14H5zM8 3v6h8V3M8 21v-7h8v7',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 8v5M12 16v.5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.2 9.6c0-1 1.2-1.7 2.8-1.7s2.8.7 2.8 1.7-1.2 1.6-2.8 1.9-2.8.8-2.8 1.9 1.2 1.9 2.8 1.9 2.8-.8 2.8-1.9M12 6.4v1.5M12 16.2v1.4',
  building: 'M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 9h5a1 1 0 0 1 1 1v11M3 21h18M8 8h2M8 12h2M8 16h2M17 13h1M17 17h1',
  calc: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 12h1M12 12h1M16 12h.01M8 16h1M12 16h1M16 16h.01',
  rocket: 'M12 3c3.2 2 5 5.2 5 9l-2 3H9l-2-3c0-3.8 1.8-7 5-9zM9 15l-2.5 4 3.5-1.5M15 15l2.5 4-3.5-1.5M12 9.5h.01',
  chart: 'M3 21h18M6 17v-5M11 17V7M16 17v-8M5.5 8.5l5-3.5 4 2 5-3.5M17 3.5h2.5V6',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 2.7-5 6-5s6 2 6 5M17 11a2.5 2.5 0 1 0 0-5M21 19c0-2.2-1.6-3.8-4-4.3',
}

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.doc} />
    </svg>
  )
}

export const SIGNAL_LABEL: Record<Signal, string> = { red: '결격', yellow: '감점', blue: '가점' }

export function SignalChip({ signal, labels }: { signal: Signal; labels?: Record<Signal, string> }) {
  return <span className={`chip chip-${signal}`}>{(labels ?? SIGNAL_LABEL)[signal]}</span>
}

/** 남색 라벨 + 연한 값 칸(입력 패널·수치 표시 공통) */
export function LabelBox({ label, children, tone }: { label: string; children: ReactNode; tone?: 'hot' | 'red' | 'yellow' | 'blue' }) {
  return (
    <div className={`labelbox ${tone ? `tone-${tone}` : ''}`}>
      <div className="lb-label">{label}</div>
      <div className="lb-value">{children}</div>
    </div>
  )
}

export function Progress({ value, tone }: { value: number; tone?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-bar ${tone ?? ''}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

export const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}
export const fmtTime = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

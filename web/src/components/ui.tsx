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

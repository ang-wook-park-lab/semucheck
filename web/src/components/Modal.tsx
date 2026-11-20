import type { ReactNode } from 'react'

export default function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose(): void; wide?: boolean }) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

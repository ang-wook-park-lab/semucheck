import type { ReactNode } from 'react'

/** 엑셀 업로드 결과를 적용하기 전에 보여 주는 확인 창(오류가 있으면 적용할 수 없다) */
export default function ImportPreview({
  title, errors, children, busy, onConfirm, onCancel, confirmLabel = '적용',
}: {
  title: string
  errors: string[]
  children?: ReactNode
  busy?: boolean
  onConfirm(): void
  onCancel(): void
  confirmLabel?: string
}) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <h2>{title}</h2>
        {errors.length > 0 ? (
          <>
            <p className="msg error">올릴 수 없는 내용이 있습니다. 엑셀 파일을 고친 뒤 다시 올려 주세요. (아무것도 저장되지 않았습니다)</p>
            <ul className="err-list">
              {errors.slice(0, 40).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            {errors.length > 40 && <p className="muted small">외 {errors.length - 40}건</p>}
          </>
        ) : (
          children
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>{errors.length ? '닫기' : '취소'}</button>
          {errors.length === 0 && (
            <button className="btn primary" onClick={onConfirm} disabled={busy}>{busy ? '저장 중…' : confirmLabel}</button>
          )}
        </div>
      </div>
    </div>
  )
}

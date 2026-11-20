import { useRef } from 'react'

/** 버튼처럼 보이는 파일 선택(.xlsx). 같은 파일을 다시 골라도 동작하도록 선택 후 값을 비운다. */
export default function FilePicker({ label, onFile, disabled, small }: { label: string; onFile(f: File): void; disabled?: boolean; small?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={`btn ${small ? 'small' : ''}`} disabled={disabled} onClick={() => ref.current?.click()}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        data-testid="xlsx-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </>
  )
}

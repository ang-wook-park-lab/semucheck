import { useState } from 'react'
import type { Domain } from '../lib/checklists'
import { downloadBlob } from '../lib/download'
import { exportDiagnosisXlsx, parseDiagnosisXlsx, xlsxFileName, ExcelError, type ParsedDiagnosis } from '../lib/excel'
import type { ReadyEditor } from '../lib/useDiagnosisEditor'
import FilePicker from './FilePicker'
import ImportPreview from './ImportPreview'
import { Icon } from './ui'

/** 진단 응답을 엑셀 양식으로 내려받고, 채운 파일을 올려 응답을 한꺼번에 반영한다 */
export default function DiagnosisExcel({ domain, ed, compact }: { domain: Domain; ed: ReadyEditor; compact?: boolean }) {
  const [parsed, setParsed] = useState<ParsedDiagnosis | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  async function download() {
    const blob = await exportDiagnosisXlsx(domain, ed.diag)
    downloadBlob(blob, xlsxFileName('진단응답', ed.client.name, domain.label + (ed.diag.mode === 'quick' ? '간단' : '')))
  }
  async function onFile(f: File) {
    setFileError(null)
    try {
      setParsed(await parseDiagnosisXlsx(domain, ed.diag, f))
    } catch (e) {
      setFileError(e instanceof ExcelError ? e.message : '엑셀 파일을 읽지 못했습니다.')
    }
  }
  return (
    <div className={compact ? 'excel-row compact' : 'excel-row'}>
      <button type="button" className="btn small" onClick={() => void download()} title="현재 응답이 채워진 엑셀 양식을 내려받습니다">
        <Icon name="download" size={15} /> 엑셀 양식·응답 다운로드
      </button>
      <FilePicker small label="엑셀로 응답 올리기" onFile={(f) => void onFile(f)} />
      {fileError && <span className="msg error small">{fileError}</span>}
      {parsed && (
        <ImportPreview
          title="엑셀 응답 올리기"
          errors={parsed.errors}
          confirmLabel="응답 반영"
          onCancel={() => setParsed(null)}
          onConfirm={() => {
            ed.replaceData(parsed.answers, parsed.notes)
            setParsed(null)
          }}
        >
          <p>{parsed.changes === 0 ? '현재 응답과 달라지는 내용이 없습니다.' : <>현재 진단에서 <b>{parsed.changes}곳</b>이 바뀝니다(응답·메모).</>}</p>
          <p className="muted small">반영하면 자동 저장됩니다. 파일에 없는 문항의 응답은 그대로 유지되고, 응답 칸을 비운 문항은 지워집니다.</p>
        </ImportPreview>
      )}
    </div>
  )
}

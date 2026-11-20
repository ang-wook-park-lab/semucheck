import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { importClientRows, listUsers } from '../lib/admin'
import { downloadBlob } from '../lib/download'
import { exportClientsXlsx, parseClientsXlsx, xlsxFileName, ExcelError, type ClientImportRow, type OwnerRef } from '../lib/excel'
import { useData } from '../lib/useData'
import { fmtDate, Icon } from '../components/ui'
import ClientForm from '../components/ClientForm'
import FilePicker from '../components/FilePicker'
import ImportPreview from '../components/ImportPreview'

export default function Clients() {
  const { user, mode } = useAuth()
  const { clients, diagnoses, reload, store, error } = useData()
  const isAdmin = user?.role === 'admin'
  const showOwner = isAdmin && mode === 'api'
  const [adding, setAdding] = useState(false)
  const [owners, setOwners] = useState<OwnerRef[]>([])
  const [preview, setPreview] = useState<{ rows: ClientImportRow[]; errors: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!showOwner) return
    listUsers()
      .then((u) => setOwners(u.filter((x) => x.active && (x.role === 'admin' || x.role === 'consultant')).map((x) => ({ id: x.id, username: x.username, name: x.name }))))
      .catch(() => setOwners([]))
  }, [showOwner])

  const template = async () => downloadBlob(await exportClientsXlsx([], { includeOwner: showOwner, template: true }), xlsxFileName('고객사_등록양식'))
  const download = async () => downloadBlob(await exportClientsXlsx(clients, { includeOwner: showOwner, owners }), xlsxFileName('고객사목록'))
  async function onFile(f: File) {
    setMsg(null)
    try {
      setPreview(await parseClientsXlsx(f, { isAdmin: showOwner, owners }))
    } catch (e) {
      setMsg(e instanceof ExcelError ? e.message : '엑셀 파일을 읽지 못했습니다.')
    }
  }
  async function confirm() {
    if (!preview || !store) return
    setBusy(true)
    try {
      const r = await importClientRows(store, mode, preview.rows, clients)
      setMsg(`가져오기 완료: 새로 ${r.created}건, 수정 ${r.updated}건`)
      setPreview(null)
      await reload()
    } catch (e) {
      setPreview({ rows: [], errors: [e instanceof Error ? e.message : '가져오지 못했습니다.'] })
    } finally {
      setBusy(false)
    }
  }
  const willUpdate = preview ? preview.rows.filter((r) => r.id && clients.some((c) => c.id === r.id)).length : 0

  return (
    <>
      <div className="title-row">
        <h1 className="page-title">{isAdmin ? '고객사 (전체)' : '내 담당 고객사'}</h1>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}>{adding ? '닫기' : '+ 고객사 등록'}</button>
      </div>
      <p className="muted scope-note">{isAdmin ? '관리자는 모든 컨설턴트의 고객사를 볼 수 있습니다.' : '내가 담당하는 고객사만 보입니다. 다른 컨설턴트의 고객사는 보이지 않습니다.'}</p>
      {error && <p className="msg error">{error}</p>}
      {msg && <p className="msg info" role="status">{msg}</p>}
      <div className="excel-row">
        <button className="btn small" onClick={() => void template()}><Icon name="download" size={15} /> 엑셀 등록 양식</button>
        <button className="btn small" onClick={() => void download()} disabled={clients.length === 0}><Icon name="download" size={15} /> 엑셀 다운로드</button>
        <FilePicker small label="엑셀 업로드" onFile={(f) => void onFile(f)} />
      </div>
      {adding && (
        <ClientForm
          onSubmit={async (c) => {
            await store?.saveClient(c)
            setAdding(false)
            await reload()
          }}
        />
      )}
      <div className="panel">
        {clients.length === 0 ? (
          <p className="empty">등록된 고객사가 없습니다.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>고객사</th>{showOwner && <th>담당 컨설턴트</th>}<th>업종</th><th>업력</th><th>근로자</th><th>진단</th><th>등록일</th></tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/clients/${c.id}`}>{c.name}</Link>{c.isSample && <span className="chip chip-gray" title="가상의 샘플 데이터">샘플</span>}</td>
                  {showOwner && <td>{c.ownerName}</td>}
                  <td>{c.profile.industry}</td>
                  <td>{c.profile.business_age}년</td>
                  <td>{c.profile.employees}명</td>
                  <td>{diagnoses.filter((d) => d.clientId === c.id).length}건</td>
                  <td>{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {preview && (
        <ImportPreview title="고객사 엑셀 업로드" errors={preview.errors} busy={busy} confirmLabel="가져오기" onCancel={() => setPreview(null)} onConfirm={() => void confirm()}>
          <p>고객사 <b>{preview.rows.length}건</b>을 가져옵니다 — 새로 등록 {preview.rows.length - willUpdate}건, 기존 고객사 수정 {willUpdate}건.</p>
          <ul className="err-list ok-list">
            {preview.rows.slice(0, 8).map((r, i) => (
              <li key={i}>{r.name} · {r.profile.industry} · {r.profile.business_type} · 업력 {r.profile.business_age}년 · 근로자 {r.profile.employees}명</li>
            ))}
          </ul>
          {preview.rows.length > 8 && <p className="muted small">외 {preview.rows.length - 8}건</p>}
          <p className="muted small">{showOwner ? '담당 컨설턴트 열이 비어 있으면 업로드한 관리자가 담당자가 됩니다. ' : '내 담당 고객사로 등록됩니다. '}한 건이라도 저장에 실패하면 전부 취소됩니다.</p>
        </ImportPreview>
      )}
    </>
  )
}

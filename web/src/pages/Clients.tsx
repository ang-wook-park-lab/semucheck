import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import { fmtDate } from '../components/ui'
import ClientForm from '../components/ClientForm'

export default function Clients() {
  const { clients, diagnoses, reload, store, error } = useData()
  const [adding, setAdding] = useState(false)
  return (
    <>
      <div className="title-row">
        <h1 className="page-title">고객사</h1>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}>{adding ? '닫기' : '+ 고객사 등록'}</button>
      </div>
      {error && <p className="msg error">{error}</p>}
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
              <tr><th>고객사</th><th>업종</th><th>업력</th><th>근로자</th><th>진단</th><th>등록일</th></tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/clients/${c.id}`}>{c.name}</Link></td>
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
    </>
  )
}

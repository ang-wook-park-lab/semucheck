import { domains } from '../lib/checklists'
import { signalOf } from '../lib/report'

export default function Library() {
  return (
    <>
      <h1 className="page-title">체크리스트 현황</h1>
      <p className="muted">체크리스트는 저장소의 <code>checklists/</code> 폴더 데이터를 그대로 읽습니다. 법령이 바뀌면 데이터만 고칩니다.</p>
      {domains.map((d) => {
        const sig = { red: 0, yellow: 0, blue: 0 }
        d.items.forEach((i) => sig[signalOf(i)]++)
        const cats = [...new Set(d.items.map((i) => i.category))]
        const unverified = d.items.filter((i) => !i.verified_at).length
        return (
          <section key={d.key} className="panel">
            <h2 className="section-title">{d.label} <span className="muted">{d.ready ? `${d.items.length}문항` : d.items.length ? `샘플 ${d.items.length}문항 · 준비 중` : '준비 중'}</span></h2>
            {d.items.length > 0 && (
              <>
                <p>
                  <span className="chip chip-red">결격 {sig.red}</span> <span className="chip chip-yellow">감점 {sig.yellow}</span> <span className="chip chip-blue">가점 {sig.blue}</span>
                </p>
                <p className="muted">카테고리: {cats.join(' / ')}</p>
                <p className="muted">법령·공고 확인일이 비어 있는 문항: {unverified}/{d.items.length} (초안 — 컨설턴트 검토 후 확정)</p>
              </>
            )}
          </section>
        )
      })}
    </>
  )
}

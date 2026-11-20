import { Link } from 'react-router-dom'
import { domains } from '../lib/checklists'
import { useAuth } from '../lib/auth'
import { fmtDate } from './ui'
import { setViewPref } from '../lib/viewMode'
import { useData } from '../lib/useData'

/**
 * 휴대폰 홈: 상담하면서 한 손으로 누르기 쉽게 5개 진단을 큰 버튼으로 보여 준다.
 * 분야마다 [정밀 진단] [간단 진단] 두 버튼 → 누르면 업체 목록(한 번 눌러 시작)으로 이동한다.
 */
export default function MobileHome() {
  const { user } = useAuth()
  const { clients, diagnoses, loading } = useData()
  const ready = domains.filter((d) => d.ready)
  const open = diagnoses.filter((d) => d.status !== 'completed').slice(0, 5)
  const nameOf = (id: string) => clients.find((c) => c.id === id)?.name ?? '(삭제된 업체)'
  const labelOf = (key: string) => domains.find((d) => d.key === key)?.label ?? key

  return (
    <div className="phone-home" data-testid="phone-home">
      <h1 className="phone-title">진단 시작</h1>
      <p className="muted phone-sub">{user?.name}님, 분야를 고른 뒤 업체를 누르면 바로 시작합니다.</p>

      <div className="pd-list">
        {ready.map((d) => (
          <section key={d.key} className="pd-card" data-testid={`pd-${d.key}`}>
            <h2 className="pd-name">{d.label}</h2>
            <div className="pd-btns">
              <Link className="pd-btn pd-full" to={`/start/${d.key}`}>
                <span>정밀 진단</span>
                <small>{d.count}{d.kind === 'status' ? '항목' : '문항'}</small>
              </Link>
              {d.quickCount > 0 && (
                <Link className="pd-btn pd-quick" to={`/start/${d.key}?mode=quick`}>
                  <span>간단 진단</span>
                  <small>{d.quickCount}{d.kind === 'status' ? '항목' : '문항'}</small>
                </Link>
              )}
            </div>
          </section>
        ))}
      </div>

      <h2 className="phone-sec">진행 중 진단 이어하기</h2>
      {loading ? (
        <p className="empty">불러오는 중…</p>
      ) : open.length === 0 ? (
        <p className="empty">진행 중인 진단이 없습니다.</p>
      ) : (
        <ul className="pr-list">
          {open.map((d) => (
            <li key={d.id}>
              <Link className="pr-row" to={`/diagnosis/${d.id}`}>
                <span className="pr-main">{nameOf(d.clientId)}</span>
                <span className="pr-sub">{labelOf(d.domain)} {d.mode === 'quick' ? '간단' : '정밀'} · {fmtDate(d.updatedAt)}</span>
                <span className="pr-go">이어하기 ›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link className="pd-wide" to="/clients">내 업체 목록 ({loading ? '–' : clients.length}곳)</Link>
      <button type="button" className="pd-wide pd-pc" onClick={() => setViewPref('pc')} data-testid="goto-pc">
        PC 버전으로 보기
        <small>업체명을 눌러 상세·표·엑셀 기능을 PC 화면 그대로 사용합니다</small>
      </button>
    </div>
  )
}

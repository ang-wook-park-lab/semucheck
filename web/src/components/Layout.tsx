import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { domains } from '../lib/checklists'
import { Icon } from './ui'

const CRUMBS: [RegExp, string[]][] = [
  [/^\/$/, ['홈']],
  [/^\/start\//, ['진단', '새 진단 시작']],
  [/^\/clients\/.+/, ['고객사', '고객사 상세']],
  [/^\/clients/, ['고객사']],
  [/^\/diagnoses/, ['진단 내역']],
  [/^\/diagnosis\//, ['진단', '체크리스트 작성']],
  [/^\/report\//, ['진단', '진단 보고서']],
  [/^\/library/, ['자료', '체크리스트 현황']],
]

export default function Layout() {
  const { user, demo, signOut } = useAuth()
  const { pathname } = useLocation()
  const crumbs = CRUMBS.find(([re]) => re.test(pathname))?.[1] ?? ['홈']
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">세무체크</div>
          <div className="brand-sub">컨설팅 진단 프로그램</div>
          <div className="brand-badge">경영컨설턴트 전용</div>
        </div>
        <nav>
          <NavLink to="/" end className="nav-item">
            <Icon name="home" /> 홈
          </NavLink>
          <div className="nav-group">진단 시작</div>
          {domains.map((d) => (
            <NavLink key={d.key} to={`/start/${d.key}`} className="nav-item">
              <Icon name="check" /> {d.label} 진단
              {!d.ready && <span className="soon">준비 중</span>}
            </NavLink>
          ))}
          <div className="nav-group">관리</div>
          <NavLink to="/clients" className="nav-item">
            <Icon name="users" /> 고객사
          </NavLink>
          <NavLink to="/diagnoses" className="nav-item">
            <Icon name="doc" /> 진단 내역 · 보고서
          </NavLink>
          <div className="nav-group">자료</div>
          <NavLink to="/library" className="nav-item">
            <Icon name="book" /> 체크리스트 현황
          </NavLink>
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={c} className={i === crumbs.length - 1 ? 'crumb-last' : ''}>
                {i > 0 && <span className="crumb-sep"> › </span>}
                {c}
              </span>
            ))}
          </div>
          <div className="top-actions">
            {demo && <span className="demo-pill" title="Supabase가 연결되지 않아 이 브라우저에만 저장됩니다">데모 모드</span>}
            <span className="who">{user?.email}</span>
            <button className="icon-btn" onClick={() => signOut()} title="로그아웃">
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

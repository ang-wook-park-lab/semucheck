import type { ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { domains } from '../lib/checklists'
import { can, ROLE_LABEL } from '../lib/permissions'
import { Icon } from './ui'

const CRUMBS: [RegExp, string[]][] = [
  [/^\/$/, ['홈']],
  [/^\/start\//, ['진단', '새 진단 시작']],
  [/^\/clients\/.+/, ['고객사', '고객사 상세']],
  [/^\/clients/, ['고객사']],
  [/^\/diagnoses/, ['진단 내역']],
  [/^\/diagnosis\//, ['진단', '체크리스트 작성']],
  [/^\/report\//, ['진단', '진단 보고서']],
  [/^\/checklists/, ['자료', '체크리스트']],
  [/^\/admin\/users/, ['관리자', '사용자 관리']],
  [/^\/account/, ['내 계정']],
]

/** 주소와 쿼리(?mode=quick)까지 비교해 활성 메뉴를 정한다 */
function NavItem({ to, icon, children, badge, tone }: { to: string; icon: string; children: ReactNode; badge?: ReactNode; tone?: 'full' | 'quick' }) {
  const { pathname, search } = useLocation()
  const [path, query = ''] = to.split('?')
  const isStart = path.startsWith('/start/')
  const active = isStart
    ? pathname === path && search.replace(/^\?/, '') === query
    : path === '/'
      ? pathname === '/'
      : pathname === path || pathname.startsWith(path + '/')
  return (
    <Link to={to} className={`nav-item ${tone ? `tone-${tone}` : ''} ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} /> {children}
      {badge}
    </Link>
  )
}

export default function Layout() {
  const { user, demo, signOut } = useAuth()
  const { pathname } = useLocation()
  const crumbs = CRUMBS.find(([re]) => re.test(pathname))?.[1] ?? ['홈']
  const role = user?.role
  const ready = domains.filter((d) => d.ready)
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">열린세무회계 컨설팅 그룹</div>
          <div className="brand-sub">진단보고서</div>
          {/* 왼쪽 위: 로그인한 컨설턴트(사용자) 이름과 역할 */}
          <div className="brand-user" data-testid="brand-user">
            <div className="brand-user-name">{user?.name}</div>
            <span className={`role-pill role-${role}`}>{role ? ROLE_LABEL[role] : ''}</span>
          </div>
        </div>
        <nav>
          <NavItem to="/" icon="home">{role === 'client' ? '내 보고서' : '홈'}</NavItem>
          {can(role, 'editData') && (
            <>
              <div className="nav-group g-full">정밀 진단 <span className="nav-hint">빠짐없이 점검</span></div>
              {ready.map((d) => (
                <NavItem key={d.key} to={`/start/${d.key}`} icon="check" tone="full">{d.label} 정밀진단</NavItem>
              ))}
              <div className="nav-group g-quick">간단 진단 <span className="nav-hint">문항 적은 버전</span></div>
              {ready.filter((d) => d.quickCount > 0).map((d) => (
                <NavItem key={d.key} to={`/start/${d.key}?mode=quick`} icon="bolt" tone="quick" badge={<span className="soon">{d.quickCount}문항</span>}>
                  {d.label} 간단진단
                </NavItem>
              ))}
              <div className="nav-group">관리</div>
              <NavItem to="/clients" icon="users">{role === 'admin' ? '고객사(전체)' : '내 담당 고객사'}</NavItem>
            </>
          )}
          {can(role, 'viewReports') && role !== 'client' && (
            <NavItem to="/diagnoses" icon="doc">진단 내역 · 보고서</NavItem>
          )}
          {can(role, 'viewChecklists') && (
            <>
              <div className="nav-group">자료</div>
              <NavItem to="/checklists" icon="book">체크리스트{role === 'admin' ? ' 관리' : ''}</NavItem>
            </>
          )}
          {can(role, 'manageUsers') && (
            <>
              <div className="nav-group">관리자</div>
              <NavItem to="/admin/users" icon="shield">사용자 · 샘플 관리</NavItem>
            </>
          )}
          <div className="nav-group">계정</div>
          <NavItem to="/account" icon="user">내 계정</NavItem>
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
            {demo && <span className="demo-pill" title="서버 DB나 Supabase가 연결되지 않아 이 브라우저에만 저장됩니다">데모 모드</span>}
            <span className="who">{user?.username}</span>
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

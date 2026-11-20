import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { ChecklistSyncProvider, useChecklistSync } from './lib/checklistSync'
import { can, type Action } from './lib/permissions'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Start from './pages/Start'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Diagnoses from './pages/Diagnoses'
import DiagnosisPage from './pages/DiagnosisPage'
import ReportPage from './pages/ReportPage'
import Checklists from './pages/Checklists'
import Users from './pages/Users'
import Account from './pages/Account'
import ForcePassword from './pages/ForcePassword'

/** 권한이 없는 주소로 들어오면 홈으로 보낸다(서버도 같은 규칙으로 막는다) */
function Guard({ action, children }: { action: Action; children: ReactNode }) {
  const { user } = useAuth()
  return can(user?.role, action) ? <>{children}</> : <Navigate to="/" replace />
}

function Authed() {
  const { ready, version } = useChecklistSync()
  if (!ready) return <div className="boot">체크리스트를 불러오는 중…</div>
  // version 이 바뀌면(관리자가 체크리스트를 수정) 화면을 다시 그려 새 내용을 반영한다
  return (
    <Routes key={version}>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="start/:domain" element={<Guard action="editData"><Start /></Guard>} />
        <Route path="clients" element={<Guard action="editData"><Clients /></Guard>} />
        <Route path="clients/:id" element={<Guard action="editData"><ClientDetail /></Guard>} />
        <Route path="diagnoses" element={<Guard action="viewReports"><Diagnoses /></Guard>} />
        <Route path="diagnosis/:id" element={<Guard action="editData"><DiagnosisPage /></Guard>} />
        <Route path="report/:id" element={<Guard action="viewReports"><ReportPage /></Guard>} />
        <Route path="checklists" element={<Guard action="viewChecklists"><Checklists /></Guard>} />
        <Route path="library" element={<Navigate to="/checklists" replace />} />
        <Route path="admin/users" element={<Guard action="manageUsers"><Users /></Guard>} />
        <Route path="account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot">불러오는 중…</div>
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }
  if (user.mustChangePassword) return <ForcePassword />
  return (
    <ChecklistSyncProvider>
      <Authed />
    </ChecklistSyncProvider>
  )
}

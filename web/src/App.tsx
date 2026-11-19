import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Start from './pages/Start'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Diagnoses from './pages/Diagnoses'
import DiagnosisPage from './pages/DiagnosisPage'
import ReportPage from './pages/ReportPage'
import Library from './pages/Library'

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
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="start/:domain" element={<Start />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="diagnoses" element={<Diagnoses />} />
        <Route path="diagnosis/:id" element={<DiagnosisPage />} />
        <Route path="report/:id" element={<ReportPage />} />
        <Route path="library" element={<Library />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

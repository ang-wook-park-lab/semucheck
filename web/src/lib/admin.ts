import { api } from './apiClient'
import type { ClientImportRow } from './excel'
import type { Client, Role } from './types'
import type { Store, StoreMode } from './store'
import { newId } from './store'

// 관리자·컨설턴트용 서버 API 호출 함수 모음(서버 DB 모드). 권한은 서버가 판단한다.
export interface AppUser {
  id: string
  username: string
  name: string
  role: Role
  active: boolean
  /** 관리자가 정해 준 임시 비밀번호를 아직 바꾸지 않았다 */
  mustChangePassword: boolean
  clientId: string | null
  clientName: string
  clientCount: number
  isSample: boolean
  createdAt: string
}

export const listUsers = () => api<AppUser[]>('GET', '/api/users')
export const createUser = (b: { username: string; name: string; role: Role; password: string; clientId?: string }) => api<AppUser>('POST', '/api/users', b)
export const updateUser = (id: string, patch: { name?: string; role?: Role; active?: boolean; clientId?: string | null; password?: string }) =>
  api<AppUser>('PATCH', `/api/users/${id}`, patch)
export const deleteUser = (id: string) => api('DELETE', `/api/users/${id}`)
export const changePassword = (currentPassword: string, newPassword: string) => api('POST', '/api/auth/password', { currentPassword, newPassword })

export const saveChecklist = (domain: string, data: unknown) => api('PUT', `/api/checklists/${domain}`, { data })
export const resetChecklist = (domain: string) => api('DELETE', `/api/checklists/${domain}`)

export interface SampleStatus {
  seededBefore: boolean
  clientCount: number
  diagnosisCount: number
  accounts: { username: string; name: string; role: Role; active: boolean }[]
}
export interface SampleAccounts {
  created: { username: string; name: string; role: Role; password: string }[]
  skipped: string[]
}
export const getSampleStatus = () => api<SampleStatus>('GET', '/api/admin/sample')
export const seedSample = () => api<{ seeded: boolean; clients: number; diagnoses: number }>('POST', '/api/admin/sample')
export const removeSample = () => api<{ clientsRemoved: number; accountsRemoved: number; accountsDeactivated: number }>('DELETE', '/api/admin/sample')
export const createSampleAccounts = () => api<SampleAccounts>('POST', '/api/admin/sample/accounts')

/** 엑셀에서 읽은 고객사 행을 저장한다. 서버 DB 모드는 한 번에(전부 성공하거나 전부 취소), 그 밖의 모드는 하나씩 저장한다. */
export async function importClientRows(store: Store, mode: StoreMode, rows: ClientImportRow[], existing: Client[]): Promise<{ created: number; updated: number }> {
  if (mode === 'api') return api<{ created: number; updated: number }>('POST', '/api/clients/import', { clients: rows })
  let created = 0
  let updated = 0
  for (const r of rows) {
    const old = r.id ? existing.find((c) => c.id === r.id) : undefined
    await store.saveClient({ id: old?.id ?? r.id ?? newId(), name: r.name, profile: r.profile, createdAt: old?.createdAt ?? new Date().toISOString() })
    if (old) updated++
    else created++
  }
  return { created, updated }
}

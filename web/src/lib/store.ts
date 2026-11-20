import type { SupabaseClient } from '@supabase/supabase-js'
import { api, ApiError } from './apiClient'
import type { Client, Diagnosis } from './types'

export interface Store {
  listClients(): Promise<Client[]>
  saveClient(c: Client): Promise<void>
  deleteClient(id: string): Promise<void>
  listDiagnoses(): Promise<Diagnosis[]>
  saveDiagnosis(d: Diagnosis): Promise<void>
  deleteDiagnosis(id: string): Promise<void>
}

export const newId = () => crypto.randomUUID()

// ---------- 데모: 브라우저 localStorage (계정별 분리) ----------
function localStore(userId: string): Store {
  const read = <T,>(name: string): T[] => {
    try {
      return JSON.parse(localStorage.getItem(`semucheck:${userId}:${name}`) ?? '[]') as T[]
    } catch {
      return []
    }
  }
  const write = (name: string, v: unknown[]) => localStorage.setItem(`semucheck:${userId}:${name}`, JSON.stringify(v))
  const upsert = <T extends { id: string }>(name: string, row: T) => {
    const rows = read<T>(name)
    const i = rows.findIndex((r) => r.id === row.id)
    if (i >= 0) rows[i] = row
    else rows.push(row)
    write(name, rows)
  }
  return {
    listClients: async () => read<Client>('clients').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    saveClient: async (c) => upsert('clients', c),
    deleteClient: async (id) => {
      write('clients', read<Client>('clients').filter((c) => c.id !== id))
      write('diagnoses', read<Diagnosis>('diagnoses').filter((d) => d.clientId !== id))
    },
    listDiagnoses: async () => read<Diagnosis>('diagnoses').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    saveDiagnosis: async (d) => upsert('diagnoses', d),
    deleteDiagnosis: async (id) => write('diagnoses', read<Diagnosis>('diagnoses').filter((d) => d.id !== id)),
  }
}

// ---------- Supabase: 테이블은 web/supabase/schema.sql, 접근 제한은 RLS(owner = auth.uid()) ----------
function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function supabaseStore(sb: SupabaseClient): Store {
  return {
    async listClients() {
      const { data, error } = await sb.from('clients').select('*').order('created_at', { ascending: false })
      fail(error)
      return (data ?? []).map((r) => ({ id: r.id, name: r.name, profile: r.profile, createdAt: r.created_at }))
    },
    async saveClient(c) {
      const { error } = await sb.from('clients').upsert({ id: c.id, name: c.name, profile: c.profile, created_at: c.createdAt })
      fail(error)
    },
    async deleteClient(id) {
      const { error } = await sb.from('clients').delete().eq('id', id)
      fail(error)
    },
    async listDiagnoses() {
      const { data, error } = await sb.from('diagnoses').select('*').order('updated_at', { ascending: false })
      fail(error)
      return (data ?? []).map((r) => ({
        id: r.id,
        clientId: r.client_id,
        domain: r.domain,
        answers: r.answers,
        notes: r.notes,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    },
    async saveDiagnosis(d) {
      const { error } = await sb.from('diagnoses').upsert({
        id: d.id,
        client_id: d.clientId,
        domain: d.domain,
        answers: d.answers,
        notes: d.notes,
        status: d.status,
        created_at: d.createdAt,
        updated_at: d.updatedAt,
      })
      fail(error)
    },
    async deleteDiagnosis(id) {
      const { error } = await sb.from('diagnoses').delete().eq('id', id)
      fail(error)
    },
  }
}

// ---------- 서버(Postgres): /api/* ----------
function apiStore(onAuthLost: () => void): Store {
  // 세션이 만료되면(401) 로그인 화면으로 돌려보낸다.
  const call = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    try {
      return await api<T>(method, path, body)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthLost()
      throw e
    }
  }
  return {
    listClients: () => call<Client[]>('GET', '/api/clients'),
    saveClient: async (c) => {
      await call('PUT', `/api/clients/${c.id}`, c)
    },
    deleteClient: async (id) => {
      await call('DELETE', `/api/clients/${id}`)
    },
    listDiagnoses: () => call<Diagnosis[]>('GET', '/api/diagnoses'),
    saveDiagnosis: async (d) => {
      await call('PUT', `/api/diagnoses/${d.id}`, d)
    },
    deleteDiagnosis: async (id) => {
      await call('DELETE', `/api/diagnoses/${id}`)
    },
  }
}

export type StoreMode = 'supabase' | 'api' | 'demo'

export function createStore(userId: string, sb: SupabaseClient | null, mode: StoreMode = sb ? 'supabase' : 'demo', onAuthLost: () => void = () => {}): Store {
  if (mode === 'api') return apiStore(onAuthLost)
  return sb ? supabaseStore(sb) : localStore(userId)
}

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { createStore, type Store, type StoreMode } from './store'
import { api, detectApi } from './apiClient'

export interface User {
  id: string
  email: string
}

interface AuthState {
  user: User | null
  loading: boolean
  /** supabase: Supabase 로그인 / api: 서버(Postgres) 로그인 / demo: 이 브라우저에만 저장 */
  mode: StoreMode
  /** 데모 모드 여부(이 브라우저에만 저장) */
  demo: boolean
  /** 서버(api) 모드에서 새 계정을 만들 수 있는지 */
  signupOpen: boolean
  store: Store | null
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<string | null>
  signOut(): Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

// 데모 모드 계정: 이 브라우저의 localStorage에만 저장되며 보안 수단이 아니다(실서비스는 Supabase 또는 서버 DB 사용).
const DEMO_USERS = 'semucheck:demo-users'
const DEMO_SESSION = 'semucheck:demo-session'

async function hash(email: string, password: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${email}:${password}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const readUsers = (): Record<string, { id: string; hash: string }> => {
  try {
    return JSON.parse(localStorage.getItem(DEMO_USERS) ?? '{}')
  } catch {
    return {}
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<StoreMode>(supabase ? 'supabase' : 'demo')
  const [signupOpen, setSignupOpen] = useState(false)

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        const u = data.session?.user
        setUser(u ? { id: u.id, email: u.email ?? '' } : null)
        setLoading(false)
      })
      const { data } = supabase.auth.onAuthStateChange((_e, session) => {
        const u = session?.user
        setUser(u ? { id: u.id, email: u.email ?? '' } : null)
      })
      return () => data.subscription.unsubscribe()
    }
    let cancelled = false
    ;(async () => {
      // 서버에 DB(API)가 연결돼 있으면 서버 로그인을 쓰고, 아니면 데모 모드로 동작한다.
      const health = await detectApi()
      if (cancelled) return
      if (health) {
        setMode('api')
        setSignupOpen(health.signup)
        try {
          const me = await api<{ user: User | null }>('GET', '/api/auth/me')
          if (!cancelled) setUser(me.user)
        } catch {
          /* 로그아웃 상태로 시작 */
        }
      } else {
        try {
          const s = localStorage.getItem(DEMO_SESSION)
          if (s) setUser(JSON.parse(s))
        } catch {
          /* 저장소를 못 읽으면 로그아웃 상태로 시작 */
        }
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      mode,
      demo: mode === 'demo',
      signupOpen,
      store: user ? createStore(user.id, supabase, mode, () => setUser(null)) : null,
      async signIn(email, password) {
        if (mode === 'api') {
          const r = await api<{ user: User }>('POST', '/api/auth/login', { email, password })
          setUser(r.user)
          return
        }
        if (supabase) {
          const { error } = await supabase.auth.signInWithPassword({ email, password })
          if (error) throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
          return
        }
        const rec = readUsers()[email.toLowerCase()]
        if (!rec || rec.hash !== (await hash(email.toLowerCase(), password))) {
          throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
        }
        const u = { id: rec.id, email: email.toLowerCase() }
        localStorage.setItem(DEMO_SESSION, JSON.stringify(u))
        setUser(u)
      },
      async signUp(email, password) {
        if (password.length < 8) throw new Error('비밀번호는 8자 이상이어야 합니다.')
        if (mode === 'api') {
          const r = await api<{ user: User }>('POST', '/api/auth/signup', { email, password })
          setUser(r.user)
          return null
        }
        if (supabase) {
          const { data, error } = await supabase.auth.signUp({ email, password })
          if (error) throw new Error(error.message)
          return data.session ? null : '가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인하세요.'
        }
        const users = readUsers()
        const key = email.toLowerCase()
        if (users[key]) throw new Error('이미 가입된 이메일입니다.')
        const u = { id: crypto.randomUUID(), email: key }
        users[key] = { id: u.id, hash: await hash(key, password) }
        localStorage.setItem(DEMO_USERS, JSON.stringify(users))
        localStorage.setItem(DEMO_SESSION, JSON.stringify(u))
        setUser(u)
        return null
      },
      async signOut() {
        if (mode === 'api') await api('POST', '/api/auth/logout', {}).catch(() => {})
        else if (supabase) await supabase.auth.signOut()
        else localStorage.removeItem(DEMO_SESSION)
        setUser(null)
      },
    }),
    [user, loading, mode, signupOpen],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AuthProvider 밖에서 useAuth를 호출했습니다.')
  return v
}

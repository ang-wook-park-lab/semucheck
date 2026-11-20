import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './apiClient'
import { useAuth } from './auth'
import { applyOverrides, resetOverrides, type ApplyResult, type OverrideInput } from './checklists'

// 로그인 후 서버에 저장된 체크리스트 수정본을 불러와 앱에 적용한다(서버 DB 모드에서만).
// version 이 바뀌면 화면 트리를 다시 그려 새 체크리스트를 반영한다.

interface SyncState {
  /** 수정본 적용이 끝났는지 (끝나기 전에는 화면을 그리지 않는다) */
  ready: boolean
  version: number
  /** 마지막 적용에서 검증을 통과하지 못해 원본을 쓰게 된 분야 */
  rejected: ApplyResult['rejected']
  reload(): Promise<ApplyResult>
}

const Ctx = createContext<SyncState | null>(null)

export function ChecklistSyncProvider({ children }: { children: ReactNode }) {
  const { user, mode } = useAuth()
  const [ready, setReady] = useState(false)
  const [version, setVersion] = useState(0)
  const [rejected, setRejected] = useState<ApplyResult['rejected']>([])

  const load = async (): Promise<ApplyResult> => {
    if (mode !== 'api' || !user) {
      resetOverrides()
      return { applied: [], rejected: [] }
    }
    try {
      const r = await api<{ overrides: Record<string, OverrideInput> }>('GET', '/api/checklists')
      return applyOverrides(r.overrides)
    } catch {
      resetOverrides() // 불러오지 못하면 원본으로 동작
      return { applied: [], rejected: [] }
    }
  }

  useEffect(() => {
    let cancelled = false
    setReady(false)
    load().then((r) => {
      if (cancelled) return
      setRejected(r.rejected)
      setVersion((v) => v + 1)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, mode])

  const value = useMemo<SyncState>(
    () => ({
      ready,
      version,
      rejected,
      async reload() {
        const r = await load()
        setRejected(r.rejected)
        setVersion((v) => v + 1)
        return r
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, version, rejected, user?.id, mode],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChecklistSync(): SyncState {
  const v = useContext(Ctx)
  if (!v) throw new Error('ChecklistSyncProvider 밖에서 useChecklistSync를 호출했습니다.')
  return v
}

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import type { Client, Diagnosis } from './types'

export function useData() {
  const { store } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!store) return
    try {
      const [c, d] = await Promise.all([store.listClients(), store.listDiagnoses()])
      setClients(c)
      setDiagnoses(d)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [store])

  useEffect(() => {
    void reload()
  }, [reload])

  return { clients, diagnoses, loading, error, reload, store }
}

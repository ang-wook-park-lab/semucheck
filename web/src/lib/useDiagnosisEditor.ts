import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from './useData'
import type { Answer, Client, Diagnosis } from './types'

/** 작성 화면(위험 규칙 방식·상태 점검 방식 공통)이 쓰는 편집 상태. 변경 0.6초 뒤 자동 저장한다. */
export interface ReadyEditor {
  diag: Diagnosis
  client: Client
  savedAt: Date | null
  saveErr: string | null
  setAnswer(itemId: string, v: Answer | undefined): void
  setNote(itemId: string, text: string): void
  finish(status: Diagnosis['status']): Promise<void>
}

export function useDiagnosisEditor(id: string | undefined) {
  const { clients, diagnoses, loading, store } = useData()
  const nav = useNavigate()
  const [diag, setDiag] = useState<Diagnosis | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const dirty = useRef(false)

  // 저장된 진단을 한 번만 불러온다. 이후 변경은 화면 상태가 기준(자동 저장).
  useEffect(() => {
    if (!diag) {
      const found = diagnoses.find((d) => d.id === id)
      if (found) setDiag(found)
    }
  }, [diagnoses, id, diag])

  useEffect(() => {
    if (!diag || !dirty.current || !store) return
    const t = setTimeout(async () => {
      try {
        await store.saveDiagnosis({ ...diag, updatedAt: new Date().toISOString() })
        dirty.current = false
        setSavedAt(new Date())
        setSaveErr(null)
      } catch (e) {
        setSaveErr(e instanceof Error ? e.message : '저장하지 못했습니다.')
      }
    }, 600)
    return () => clearTimeout(t)
  }, [diag, store])

  const setAnswer = useCallback((itemId: string, v: Answer | undefined) => {
    dirty.current = true
    setDiag((d) => {
      if (!d) return d
      const answers = { ...d.answers }
      if (v === undefined) delete answers[itemId]
      else answers[itemId] = v
      return { ...d, answers }
    })
  }, [])

  const setNote = useCallback((itemId: string, text: string) => {
    dirty.current = true
    setDiag((d) => {
      if (!d) return d
      const notes = { ...d.notes }
      if (text) notes[itemId] = text
      else delete notes[itemId]
      return { ...d, notes }
    })
  }, [])

  const finish = useCallback(
    async (status: Diagnosis['status']) => {
      if (!store || !diag) return
      try {
        await store.saveDiagnosis({ ...diag, status, updatedAt: new Date().toISOString() })
        dirty.current = false
        nav(`/report/${diag.id}`)
      } catch (e) {
        setSaveErr(e instanceof Error ? e.message : '저장하지 못했습니다.')
      }
    },
    [store, diag, nav],
  )

  return {
    loading,
    diag,
    client: clients.find((c) => c.id === diag?.clientId),
    exists: diagnoses.some((d) => d.id === id),
    savedAt,
    saveErr,
    setAnswer,
    setNote,
    finish,
  }
}

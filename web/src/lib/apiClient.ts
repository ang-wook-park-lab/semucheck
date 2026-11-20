// 세무체크 서버 API(Postgres) 호출 도우미. 로그인 상태는 HttpOnly 쿠키로 유지되므로 토큰을 저장하지 않는다.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했습니다. 네트워크를 확인하세요.')
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null
  if (!res.ok) throw new ApiError(res.status, (data && typeof data.error === 'string' && data.error) || '요청을 처리하지 못했습니다.')
  return data as T
}

/** 서버 DB(API) 감지 결과. api 가 아니면 데모 모드로 동작하며, 나머지 값은 화면에 원인을 알려 주는 데 쓴다. */
export type ApiDetection =
  | { kind: 'api' }
  | { kind: 'nodb' } // 서버는 응답했지만 DATABASE_URL 이 연결되지 않음
  | { kind: 'unavailable' } // API 가 없는 서버(개발 서버)이거나 네트워크 오류

export async function detectApi(): Promise<ApiDetection> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch('/api/health', { credentials: 'same-origin', signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return { kind: 'unavailable' }
    const j = (await res.json()) as { db?: boolean }
    return j.db === true ? { kind: 'api' } : { kind: 'nodb' }
  } catch {
    return { kind: 'unavailable' }
  }
}

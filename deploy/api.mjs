// 세무체크 Postgres API. DATABASE_URL 이 있을 때만 server.mjs 가 불러온다(Railway Postgres 등).
//  - 계정: 이메일+비밀번호(scrypt 해시), 로그인 세션은 HttpOnly 쿠키(토큰은 해시로만 DB 저장)
//  - 데이터: 컨설턴트(계정)별 고객사·진단. 모든 쿼리는 소유자(owner)로 한정한다.
//  - 가입: 첫 계정은 누구나 만들 수 있고, 이후에는 ALLOW_SIGNUP=true 일 때만 가입할 수 있다.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const COOKIE = 'sc_session'
const SESSION_DAYS = 14
const MAX_BODY = 1_000_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN_RE = /^[a-z0-9-]{1,50}$/
const STATUSES = new Set(['in_progress', 'completed'])
const LOGIN_MAX_FAILS = 10
const LOGIN_WINDOW_MS = 15 * 60_000

const MIGRATION = `
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists app_sessions (
  token_hash text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists app_sessions_user_idx on app_sessions(user_id);
create table if not exists app_clients (
  id uuid primary key,
  owner uuid not null references app_users(id) on delete cascade,
  name text not null,
  profile jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists app_clients_owner_idx on app_clients(owner, created_at desc);
create table if not exists app_diagnoses (
  id uuid primary key,
  owner uuid not null references app_users(id) on delete cascade,
  client_id uuid not null references app_clients(id) on delete cascade,
  domain text not null,
  answers jsonb not null default '{}'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_diagnoses_owner_idx on app_diagnoses(owner, updated_at desc);
create index if not exists app_diagnoses_client_idx on app_diagnoses(client_id);
`

// ---------- 비밀번호 ----------
const SCRYPT = { N: 16384, r: 8, p: 1 }
async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, 64, { ...SCRYPT, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}
async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$')
  if (alg !== 'scrypt' || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const validDate = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null)

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const clientOut = (r) => ({ id: r.id, name: r.name, profile: r.profile, createdAt: r.created_at.toISOString() })
const diagOut = (r) => ({
  id: r.id,
  clientId: r.client_id,
  domain: r.domain,
  answers: r.answers,
  notes: r.notes,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
})

export async function createDbApi({ connectionString, ssl = false, allowSignup = false, pool: given } = {}) {
  let pool = given
  if (!pool) {
    const pg = (await import('pg')).default
    pool = new pg.Pool({ connectionString, ssl: ssl ? { rejectUnauthorized: false } : undefined, max: 10, connectionTimeoutMillis: 10_000 })
    pool.on('error', (e) => console.error('DB 풀 오류', e.message))
  }

  // 시작할 때 테이블을 만든다(여러 인스턴스가 동시에 시작해도 안전하도록 어드바이저리 락 사용)
  {
    const c = await pool.connect()
    try {
      await c.query('select pg_advisory_lock(72630011)')
      await c.query(MIGRATION)
    } finally {
      await c.query('select pg_advisory_unlock(72630011)').catch(() => {})
      c.release()
    }
  }

  const fails = new Map() // `${ip}|${email}` → { count, resetAt }
  let dummyHash = null

  const signupOpen = async () => {
    if (allowSignup) return true
    const { rows } = await pool.query('select count(*)::int as n from app_users')
    return rows[0].n === 0
  }

  // ---------- HTTP 도우미 ----------
  const reply = (res, headers, status, body, extra = {}) => {
    const buf = Buffer.from(body === undefined ? '' : JSON.stringify(body))
    res.writeHead(status, {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': buf.length,
      ...extra,
    })
    res.end(buf)
  }

  const readJson = (req) =>
    new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return reject(new HttpError(415, 'Content-Type 은 application/json 이어야 합니다.'))
      let size = 0
      let tooBig = false
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY) {
          // 413 을 먼저 돌려주고 남은 본문은 버린다(바로 끊으면 클라이언트가 응답을 못 받는다). 비정상적으로 크면 연결을 끊는다.
          if (!tooBig) {
            tooBig = true
            reject(new HttpError(413, '요청이 너무 큽니다.'))
          }
          if (size > MAX_BODY * 8) req.destroy()
        } else if (!tooBig) chunks.push(c)
      })
      req.on('end', () => {
        if (tooBig) return
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          if (!isObj(v)) throw new Error()
          resolve(v)
        } catch {
          reject(new HttpError(400, '올바른 JSON 이 아닙니다.'))
        }
      })
      req.on('error', () => reject(new HttpError(400, '요청을 읽지 못했습니다.')))
    })

  const parseCookies = (req) => {
    const out = {}
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const i = part.indexOf('=')
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
    }
    return out
  }
  const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted)
  const sessionCookie = (req, token, maxAge) =>
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`
  const clientIp = (req) => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()

  /** 상태를 바꾸는 요청은 같은 사이트에서 온 것만 허용한다(CSRF 방어). */
  function assertSameSite(req) {
    const origin = req.headers.origin
    if (origin) {
      let host = ''
      try {
        host = new URL(origin).host
      } catch {
        /* 잘못된 Origin */
      }
      if (host !== req.headers.host) throw new HttpError(403, '허용되지 않은 출처의 요청입니다.')
    } else {
      const site = req.headers['sec-fetch-site']
      if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, '허용되지 않은 출처의 요청입니다.')
    }
  }

  async function currentUser(req) {
    const token = parseCookies(req)[COOKIE]
    if (!token || token.length > 200) return null
    const { rows } = await pool.query(
      `select u.id, u.email from app_sessions s join app_users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [sha256(token)],
    )
    return rows[0] ?? null
  }

  async function startSession(req, res, headers, user, status = 200) {
    const token = randomBytes(32).toString('base64url')
    await pool.query('delete from app_sessions where user_id = $1 and expires_at < now()', [user.id])
    await pool.query(`insert into app_sessions (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`, [sha256(token), user.id, String(SESSION_DAYS)])
    reply(res, headers, status, { user: { id: user.id, email: user.email } }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) })
  }

  function credentials(body) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, '이메일 형식이 올바르지 않습니다.')
    if (password.length > 200) throw new HttpError(400, '비밀번호가 너무 깁니다.')
    return { email, password }
  }

  // ---------- 라우트 ----------
  async function route(req, res, headers, pathname, user) {
    const method = req.method
    const seg = pathname.split('/').filter(Boolean) // ['api', ...]
    const need = () => {
      if (!user) throw new HttpError(401, '로그인이 필요합니다.')
      return user
    }
    const idParam = () => {
      if (!UUID_RE.test(seg[2] ?? '')) throw new HttpError(400, 'ID 형식이 올바르지 않습니다.')
      return seg[2].toLowerCase()
    }

    if (pathname === '/api/health') {
      if (method !== 'GET') throw new HttpError(405, 'GET 만 허용됩니다.')
      return reply(res, headers, 200, { ok: true, db: true, signup: await signupOpen() })
    }

    if (seg[1] === 'auth') {
      if (seg[2] === 'me' && method === 'GET') return reply(res, headers, 200, { user: user ? { id: user.id, email: user.email } : null })
      if (seg[2] === 'logout' && method === 'POST') {
        const token = parseCookies(req)[COOKIE]
        if (token) await pool.query('delete from app_sessions where token_hash = $1', [sha256(token)])
        return reply(res, headers, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) })
      }
      if (seg[2] === 'signup' && method === 'POST') {
        const { email, password } = credentials(await readJson(req))
        if (password.length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.')
        if (!(await signupOpen())) throw new HttpError(403, '가입이 닫혀 있습니다. 관리자에게 계정 생성을 요청하세요.')
        try {
          const { rows } = await pool.query('insert into app_users (email, password_hash) values ($1, $2) returning id, email', [email, await hashPassword(password)])
          return startSession(req, res, headers, rows[0], 201)
        } catch (e) {
          if (e.code === '23505') throw new HttpError(409, '이미 가입된 이메일입니다.')
          throw e
        }
      }
      if (seg[2] === 'login' && method === 'POST') {
        const { email, password } = credentials(await readJson(req))
        const key = `${clientIp(req)}|${email}`
        const now = Date.now()
        const rec = fails.get(key)
        if (rec && rec.resetAt > now && rec.count >= LOGIN_MAX_FAILS) throw new HttpError(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.')
        const { rows } = await pool.query('select id, email, password_hash from app_users where email = $1', [email])
        let good = false
        if (rows[0]) good = await verifyPassword(password, rows[0].password_hash)
        else {
          dummyHash ??= await hashPassword('dummy-password-for-timing')
          await verifyPassword(password, dummyHash) // 계정 존재 여부가 응답 시간으로 드러나지 않게 한다
        }
        if (!good) {
          const cur = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + LOGIN_WINDOW_MS }
          cur.count++
          fails.set(key, cur)
          throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.')
        }
        fails.delete(key)
        return startSession(req, res, headers, rows[0])
      }
      throw new HttpError(seg[2] ? 405 : 404, '지원하지 않는 요청입니다.')
    }

    if (seg[1] === 'clients') {
      if (seg.length === 2 && method === 'GET') {
        const { rows } = await pool.query('select * from app_clients where owner = $1 order by created_at desc', [need().id])
        return reply(res, headers, 200, rows.map(clientOut))
      }
      if (seg.length === 3 && method === 'PUT') {
        const u = need()
        const id = idParam()
        const b = await readJson(req)
        const name = typeof b.name === 'string' ? b.name.trim() : ''
        if (!name || name.length > 200) throw new HttpError(400, '고객사명은 1~200자여야 합니다.')
        if (!isObj(b.profile)) throw new HttpError(400, '고객사 정보(profile)가 필요합니다.')
        const { rows } = await pool.query(
          `insert into app_clients (id, owner, name, profile, created_at) values ($1, $2, $3, $4::jsonb, $5)
           on conflict (id) do update set name = excluded.name, profile = excluded.profile
           where app_clients.owner = excluded.owner
           returning *`,
          [id, u.id, name, JSON.stringify(b.profile), validDate(b.createdAt) ?? new Date()],
        )
        if (!rows[0]) throw new HttpError(409, '이미 사용 중인 ID 입니다.')
        return reply(res, headers, 200, clientOut(rows[0]))
      }
      if (seg.length === 3 && method === 'DELETE') {
        await pool.query('delete from app_clients where id = $1 and owner = $2', [idParam(), need().id])
        return reply(res, headers, 200, { ok: true })
      }
      throw new HttpError(405, '지원하지 않는 요청입니다.')
    }

    if (seg[1] === 'diagnoses') {
      if (seg.length === 2 && method === 'GET') {
        const { rows } = await pool.query('select * from app_diagnoses where owner = $1 order by updated_at desc', [need().id])
        return reply(res, headers, 200, rows.map(diagOut))
      }
      if (seg.length === 3 && method === 'PUT') {
        const u = need()
        const id = idParam()
        const b = await readJson(req)
        if (typeof b.clientId !== 'string' || !UUID_RE.test(b.clientId)) throw new HttpError(400, 'clientId 형식이 올바르지 않습니다.')
        if (typeof b.domain !== 'string' || !DOMAIN_RE.test(b.domain)) throw new HttpError(400, 'domain 형식이 올바르지 않습니다.')
        if (!isObj(b.answers) || !isObj(b.notes)) throw new HttpError(400, 'answers 와 notes 는 객체여야 합니다.')
        if (Object.keys(b.answers).length > 2000 || Object.keys(b.notes).length > 2000) throw new HttpError(400, '항목이 너무 많습니다.')
        if (!STATUSES.has(b.status)) throw new HttpError(400, 'status 값이 올바르지 않습니다.')
        const created = validDate(b.createdAt) ?? new Date()
        const updated = validDate(b.updatedAt) ?? new Date()
        const { rows } = await pool.query(
          `insert into app_diagnoses (id, owner, client_id, domain, answers, notes, status, created_at, updated_at)
           select $1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6::jsonb, $7, $8, $9
           where exists (select 1 from app_clients where id = $3::uuid and owner = $2::uuid)
           on conflict (id) do update set domain = excluded.domain, answers = excluded.answers, notes = excluded.notes,
             status = excluded.status, updated_at = excluded.updated_at
           where app_diagnoses.owner = excluded.owner
           returning *`,
          [id, u.id, b.clientId.toLowerCase(), b.domain, JSON.stringify(b.answers), JSON.stringify(b.notes), b.status, created, updated],
        )
        if (!rows[0]) throw new HttpError(404, '고객사를 찾을 수 없습니다.')
        return reply(res, headers, 200, diagOut(rows[0]))
      }
      if (seg.length === 3 && method === 'DELETE') {
        await pool.query('delete from app_diagnoses where id = $1 and owner = $2', [idParam(), need().id])
        return reply(res, headers, 200, { ok: true })
      }
      throw new HttpError(405, '지원하지 않는 요청입니다.')
    }

    throw new HttpError(404, '존재하지 않는 API 입니다.')
  }

  /** server.mjs 가 /api/* 요청을 넘겨 준다. headers 는 서버가 붙이는 보안 헤더. */
  async function handle(req, res, { pathname, headers }) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') assertSameSite(req)
      const user = pathname === '/api/health' ? null : await currentUser(req)
      await route(req, res, headers, pathname, user)
    } catch (err) {
      if (err instanceof HttpError) return reply(res, headers, err.status, { error: err.message }, err.status === 413 ? { Connection: 'close' } : {})
      console.error('API 오류', err)
      if (!res.headersSent) reply(res, headers, 500, { error: '서버 오류가 발생했습니다.' })
      else res.end()
    }
  }

  return { handle, pool, signupOpen, close: () => pool.end() }
}


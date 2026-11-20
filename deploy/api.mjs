// 세무체크 Postgres API. DATABASE_URL 이 있을 때만 server.mjs 가 불러온다(Railway Postgres 등).
//  - 계정: 아이디+비밀번호(scrypt 해시), 로그인 세션은 HttpOnly 쿠키(토큰은 해시로만 DB 저장)
//  - 역할: admin(관리자) / consultant(컨설턴트) / client(고객). 권한은 항상 서버에서 판단한다(화면은 안내용).
//      admin      : 모든 데이터 조회·수정, 사용자 관리, 체크리스트 수정, 샘플 데이터 관리
//      consultant : 자기 고객사·진단만 조회·수정, 체크리스트는 조회만
//      client     : 자기 회사(연결된 고객사)의 완료된 진단 보고서만 조회(읽기 전용)
//  - 가입 기능은 없다. 계정은 관리자가 직접 만들고(아이디·임시 비밀번호), 본인은 첫 로그인 때 비밀번호를 바꿔야 한다.
//    계정이 하나도 없을 때만 서버가 시작하면서 최초 관리자(ADMIN_USERNAME, 기본 admin)를 만든다.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { createSampleAccounts, ensureSampleSeeded, removeSample, sampleStatus, seedSample } from './sample.mjs'

const scryptAsync = promisify(scrypt)

const COOKIE = 'sc_session'
const SESSION_DAYS = 14
const MAX_BODY = 1_000_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 새 아이디: 영문 소문자·숫자·. _ - 로 3~30자(첫 글자는 영문/숫자). 예전에 이메일로 만든 계정은 그대로 로그인할 수 있다. */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/
const DOMAIN_RE = /^[a-z0-9-]{1,50}$/
const STATUSES = new Set(['in_progress', 'completed'])
const MODES = new Set(['full', 'quick'])
const ROLES = new Set(['admin', 'consultant', 'client'])
const LOGIN_MAX_FAILS = 10
const LOGIN_WINDOW_MS = 15 * 60_000
const IMPORT_MAX_ROWS = 500

const MIGRATION = `
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);
-- 이메일로 로그인하던 예전 계정은 이메일 값을 그대로 아이디로 쓴다.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'app_users' and column_name = 'email')
     and not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'app_users' and column_name = 'username') then
    alter table app_users rename column email to username;
  end if;
end $$;
alter table app_users add column if not exists must_change_password boolean not null default false;
alter table app_users add column if not exists name text not null default '';
alter table app_users add column if not exists role text not null default 'consultant';
alter table app_users add column if not exists active boolean not null default true;
alter table app_users add column if not exists client_id uuid;
alter table app_users add column if not exists is_sample boolean not null default false;
alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check check (role in ('admin', 'consultant', 'client'));
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
alter table app_clients add column if not exists is_sample boolean not null default false;
create index if not exists app_clients_owner_idx on app_clients(owner, created_at desc);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_users_client_fk') then
    alter table app_users add constraint app_users_client_fk foreign key (client_id) references app_clients(id) on delete set null;
  end if;
end $$;
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
alter table app_diagnoses add column if not exists mode text not null default 'full';
alter table app_diagnoses drop constraint if exists app_diagnoses_mode_check;
alter table app_diagnoses add constraint app_diagnoses_mode_check check (mode in ('full', 'quick'));
create index if not exists app_diagnoses_owner_idx on app_diagnoses(owner, updated_at desc);
create index if not exists app_diagnoses_client_idx on app_diagnoses(client_id);
create table if not exists app_checklists (
  domain text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id) on delete set null
);
create table if not exists app_meta (
  key text primary key,
  value text not null
);
-- 역할 도입 전에 만들어진 계정만 있고 관리자가 없으면 가장 먼저 만든 계정을 관리자로 올린다.
update app_users set role = 'admin'
 where id = (select id from app_users order by created_at asc limit 1)
   and not exists (select 1 from app_users where role = 'admin');
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
const str = (v, max) => typeof v === 'string' && v.length <= max

class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

const userOut = (u) => ({ id: u.id, username: u.username, name: u.name ?? '', role: u.role, clientId: u.client_id ?? null, mustChangePassword: Boolean(u.must_change_password) })
const clientOut = (r) => ({
  id: r.id,
  name: r.name,
  profile: r.profile,
  createdAt: r.created_at.toISOString(),
  ownerId: r.owner,
  ownerName: r.owner_name || r.owner_username || '',
  isSample: Boolean(r.is_sample),
})
const diagOut = (r) => ({
  id: r.id,
  clientId: r.client_id,
  domain: r.domain,
  answers: r.answers,
  notes: r.notes,
  status: r.status,
  mode: r.mode,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
})

const CLIENT_SELECT = `select c.*, u.username as owner_username, u.name as owner_name
  from app_clients c join app_users u on u.id = c.owner`

// ---------- 입력 검증 ----------
function validateClientBody(b) {
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name || name.length > 200) throw new HttpError(400, '고객사명은 1~200자여야 합니다.')
  if (!isObj(b.profile)) throw new HttpError(400, '고객사 정보(profile)가 필요합니다.')
  return { name, profile: b.profile, createdAt: validDate(b.createdAt) ?? new Date() }
}

const RISK_TYPES = new Set(['yes_no', 'number', 'single_choice'])
const SIGNALS = new Set(['red', 'yellow', 'blue'])
const LEVELS = new Set(['high', 'medium', 'low'])
const ID_RE = /^[A-Za-z0-9_-]{1,30}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 체크리스트 구조 검증(서버는 규칙 문법까지는 해석하지 않는다. 문법은 화면이 불러올 때 다시 검사하고, 틀리면 원본을 쓴다). */
function validateChecklist(domain, data) {
  const errors = []
  const add = (m) => errors.length < 30 && errors.push(m)
  if (Array.isArray(data)) {
    if (data.length === 0 || data.length > 500) add('문항 수는 1~500개여야 합니다.')
    const ids = new Set()
    data.forEach((it, i) => {
      const at = `${i + 1}번째 문항`
      if (!isObj(it)) return add(`${at}: 객체가 아닙니다.`)
      if (typeof it.id !== 'string' || !ID_RE.test(it.id)) add(`${at}: id 형식이 올바르지 않습니다.`)
      else if (ids.has(it.id)) add(`${at}: id 가 중복됩니다 (${it.id}).`)
      else ids.add(it.id)
      const label = typeof it.id === 'string' ? it.id : at
      if (it.domain !== domain) add(`${label}: domain 은 ${domain} 이어야 합니다.`)
      if (!str(it.category, 100) || !it.category) add(`${label}: 카테고리가 필요합니다.`)
      if (!str(it.question, 1000) || !it.question) add(`${label}: 질문이 필요합니다.`)
      if (it.help !== undefined && !str(it.help, 3000)) add(`${label}: 도움말이 너무 깁니다.`)
      if (!RISK_TYPES.has(it.answer_type)) add(`${label}: answer_type 은 yes_no / number / single_choice 중 하나여야 합니다.`)
      if (it.answer_type === 'single_choice' && !(Array.isArray(it.options) && it.options.length > 0 && it.options.length <= 30 && it.options.every((o) => str(o, 200) && o))) {
        add(`${label}: 선택형 문항에는 선택지가 필요합니다.`)
      }
      if (it.applies_if !== undefined && !str(it.applies_if, 1000)) add(`${label}: applies_if 가 올바르지 않습니다.`)
      if (!str(it.risk_rule, 1000) || !it.risk_rule) add(`${label}: risk_rule 이 필요합니다.`)
      if (!SIGNALS.has(it.signal)) add(`${label}: signal 은 red / yellow / blue 중 하나여야 합니다.`)
      if (!LEVELS.has(it.risk_level)) add(`${label}: risk_level 은 high / medium / low 중 하나여야 합니다.`)
      if (it.score_weight !== undefined && !(typeof it.score_weight === 'number' && it.score_weight >= 0 && it.score_weight <= 100)) add(`${label}: score_weight 는 0~100 숫자여야 합니다.`)
      if (!str(it.recommendation, 3000) || !it.recommendation) add(`${label}: 개선 권고가 필요합니다.`)
      for (const k of ['legal_basis', 'consequence', 'source']) if (it[k] !== undefined && !str(it[k], 3000)) add(`${label}: ${k} 가 너무 깁니다.`)
      if (it.verified_at !== undefined && it.verified_at !== '' && !(typeof it.verified_at === 'string' && DATE_RE.test(it.verified_at))) add(`${label}: verified_at 은 YYYY-MM-DD 형식이어야 합니다.`)
    })
  } else if (isObj(data) && Array.isArray(data.areas)) {
    if (!str(data.title, 300) || !data.title) add('title 이 필요합니다.')
    if (data.domain !== domain) add(`domain 은 ${domain} 이어야 합니다.`)
    if (!Array.isArray(data.status_options) || data.status_options.length !== 4) add('status_options 는 4개(ok/fix/bad/na)여야 합니다.')
    let total = 0
    const ids = new Set()
    if (data.areas.length === 0 || data.areas.length > 30) add('영역 수는 1~30개여야 합니다.')
    data.areas.forEach((a, i) => {
      const at = `${i + 1}번째 영역`
      if (!isObj(a) || !str(a.id, 30) || !a.id || !str(a.name, 200) || !a.name || !str(a.key_point, 500)) return add(`${at}: id·name·key_point 가 필요합니다.`)
      if (!Array.isArray(a.items) || a.items.length === 0) return add(`${at}: 항목이 필요합니다.`)
      a.items.forEach((it, j) => {
        total++
        const label = isObj(it) && typeof it.id === 'string' ? it.id : `${at} ${j + 1}번째 항목`
        if (!isObj(it)) return add(`${label}: 객체가 아닙니다.`)
        if (typeof it.id !== 'string' || !ID_RE.test(it.id)) add(`${label}: id 형식이 올바르지 않습니다.`)
        else if (ids.has(it.id)) add(`${label}: id 가 중복됩니다.`)
        else ids.add(it.id)
        if (!str(it.text, 500) || !it.text) add(`${label}: 점검 항목이 필요합니다.`)
        if (!str(it.check, 2000) || !it.check) add(`${label}: 점검 포인트가 필요합니다.`)
        if (!str(it.recommendation, 3000) || !it.recommendation) add(`${label}: 개선 권고가 필요합니다.`)
        if (!LEVELS.has(it.risk_level)) add(`${label}: risk_level 이 올바르지 않습니다.`)
        if (it.legal_basis !== undefined && !str(it.legal_basis, 1000)) add(`${label}: legal_basis 가 너무 깁니다.`)
        if (it.verified_at !== undefined && it.verified_at !== '' && !(typeof it.verified_at === 'string' && DATE_RE.test(it.verified_at))) add(`${label}: verified_at 형식이 올바르지 않습니다.`)
      })
    })
    if (total > 500) add('항목 수는 500개 이하여야 합니다.')
  } else {
    add('체크리스트 형식이 올바르지 않습니다(문항 배열 또는 areas 가 있는 객체).')
  }
  return errors
}

/**
 * 계정이 하나도 없으면 최초 관리자를 만든다(가입 기능이 없으므로 이것이 유일한 시작점).
 *  - 아이디: ADMIN_USERNAME(기본 admin), 비밀번호: ADMIN_PASSWORD. 비밀번호가 없으면 무작위로 만들어 서버 로그에 한 번만 출력한다.
 *  - 첫 로그인 때 비밀번호를 바꿔야 한다.
 * resetAdmin(ADMIN_RESET=true)이면 ADMIN_USERNAME 계정의 비밀번호를 ADMIN_PASSWORD 로 되돌리고(없으면 만들고) 관리자·활성 상태로 만든다(비밀번호 분실 복구용).
 */
export async function bootstrapAdmin(pool, { adminUsername, adminPassword, resetAdmin = false } = {}) {
  const username = (adminUsername || 'admin').trim().toLowerCase()
  const { rows: cnt } = await pool.query('select count(*)::int as n from app_users')
  if (resetAdmin && adminPassword) {
    const hash = await hashPassword(adminPassword)
    const found = await pool.query('select id from app_users where username = $1', [username])
    if (found.rows[0]) {
      await pool.query(`update app_users set password_hash = $2, role = 'admin', active = true, client_id = null, must_change_password = true where id = $1`, [found.rows[0].id, hash])
      await pool.query('delete from app_sessions where user_id = $1', [found.rows[0].id])
    } else {
      await pool.query(`insert into app_users (username, name, role, password_hash, must_change_password) values ($1, '관리자', 'admin', $2, true)`, [username, hash])
    }
    console.log(`관리자 계정 '${username}' 의 비밀번호를 ADMIN_PASSWORD 로 재설정했습니다. 복구가 끝났으면 ADMIN_RESET 변수를 지우세요.`)
    return
  }
  if (cnt[0].n > 0) return
  if (!USERNAME_RE.test(username)) throw new Error('ADMIN_USERNAME 은 영문 소문자·숫자·. _ - 로 3~30자여야 합니다.')
  if (adminPassword && adminPassword.length < 8) throw new Error('ADMIN_PASSWORD 는 8자 이상이어야 합니다.')
  const password = adminPassword || randomBytes(9).toString('base64url')
  await pool.query(`insert into app_users (username, name, role, password_hash, must_change_password) values ($1, '관리자', 'admin', $2, true)`, [username, await hashPassword(password)])
  console.log(adminPassword ? `최초 관리자 계정을 만들었습니다. 아이디: ${username} (비밀번호는 ADMIN_PASSWORD, 첫 로그인 때 변경)` : `최초 관리자 계정을 만들었습니다. 아이디: ${username} / 임시 비밀번호: ${password} (이 로그에만 한 번 표시됩니다. 첫 로그인 때 변경하세요)`)
}

export async function createDbApi({ connectionString, ssl = false, adminUsername, adminPassword, resetAdmin = false, pool: given } = {}) {
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
  await bootstrapAdmin(pool, { adminUsername, adminPassword, resetAdmin })
  // 관리자가 이미 있으면(이전에 만든 계정 포함) 샘플 데이터를 한 번만 넣는다
  await ensureSampleSeeded(pool).catch((e) => console.error('샘플 데이터 입력 실패(무시)', e.message))

  const fails = new Map() // `${ip}|${username}` → { count, resetAt }
  let dummyHash = null

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
      `select u.id, u.username, u.name, u.role, u.client_id, u.must_change_password from app_sessions s join app_users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now() and u.active`,
      [sha256(token)],
    )
    return rows[0] ?? null
  }

  async function startSession(req, res, headers, user, status = 200) {
    const token = randomBytes(32).toString('base64url')
    await pool.query('delete from app_sessions where user_id = $1 and expires_at < now()', [user.id])
    await pool.query(`insert into app_sessions (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`, [sha256(token), user.id, String(SESSION_DAYS)])
    reply(res, headers, status, { user: userOut(user) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) })
  }

  /** 로그인 입력: 아이디는 소문자로 맞추고 형식은 따지지 않는다(예전 이메일 아이디도 로그인해야 하므로). */
  function loginInput(body) {
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!username || username.length > 254) throw new HttpError(400, '아이디를 입력하세요.')
    if (password.length > 200) throw new HttpError(400, '비밀번호가 너무 깁니다.')
    return { username, password }
  }
  /** 새 계정을 만들 때의 아이디·비밀번호 검사 */
  function newAccountInput(body) {
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!USERNAME_RE.test(username)) throw new HttpError(400, '아이디는 영문 소문자·숫자·마침표(.)·밑줄(_)·하이픈(-)으로 3~30자여야 합니다.')
    if (password.length < 8 || password.length > 200) throw new HttpError(400, '임시 비밀번호는 8자 이상이어야 합니다.')
    return { username, password }
  }

  const activeAdmins = async (db = pool) => (await db.query(`select count(*)::int as n from app_users where role = 'admin' and active`)).rows[0].n

  /** owner 로 지정할 수 있는 사용자(활성 관리자·컨설턴트)인지 확인한다 */
  async function assertOwnerCandidate(ownerId) {
    if (typeof ownerId !== 'string' || !UUID_RE.test(ownerId)) throw new HttpError(400, '담당자 ID 형식이 올바르지 않습니다.')
    const { rows } = await pool.query(`select id from app_users where id = $1 and active and role in ('admin','consultant')`, [ownerId.toLowerCase()])
    if (!rows[0]) throw new HttpError(400, '담당자는 활성 상태의 관리자 또는 컨설턴트여야 합니다.')
    return ownerId.toLowerCase()
  }

  // ---------- 라우트 ----------
  async function route(req, res, headers, pathname, user) {
    const method = req.method
    const seg = pathname.split('/').filter(Boolean) // ['api', ...]
    const need = (...roles) => {
      if (!user) throw new HttpError(401, '로그인이 필요합니다.')
      if (roles.length && !roles.includes(user.role)) throw new HttpError(403, '이 작업을 할 권한이 없습니다.')
      return user
    }
    const uuidAt = (i) => {
      if (!UUID_RE.test(seg[i] ?? '')) throw new HttpError(400, 'ID 형식이 올바르지 않습니다.')
      return seg[i].toLowerCase()
    }

    if (pathname === '/api/health') {
      if (method !== 'GET') throw new HttpError(405, 'GET 만 허용됩니다.')
      return reply(res, headers, 200, { ok: true, db: true })
    }

    // ===== 인증 =====
    if (seg[1] === 'auth') {
      if (seg[2] === 'me' && method === 'GET') return reply(res, headers, 200, { user: user ? userOut(user) : null })
      if (seg[2] === 'logout' && method === 'POST') {
        const token = parseCookies(req)[COOKIE]
        if (token) await pool.query('delete from app_sessions where token_hash = $1', [sha256(token)])
        return reply(res, headers, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) })
      }
      if (seg[2] === 'login' && method === 'POST') {
        const { username, password } = loginInput(await readJson(req))
        const key = `${clientIp(req)}|${username}`
        const now = Date.now()
        const rec = fails.get(key)
        if (rec && rec.resetAt > now && rec.count >= LOGIN_MAX_FAILS) throw new HttpError(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.')
        const { rows } = await pool.query('select id, username, name, role, client_id, active, must_change_password, password_hash from app_users where username = $1', [username])
        let good = false
        if (rows[0]) good = (await verifyPassword(password, rows[0].password_hash)) && rows[0].active
        else {
          dummyHash ??= await hashPassword('dummy-password-for-timing')
          await verifyPassword(password, dummyHash) // 계정 존재 여부가 응답 시간으로 드러나지 않게 한다
        }
        if (!good) {
          const cur = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + LOGIN_WINDOW_MS }
          cur.count++
          fails.set(key, cur)
          throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.')
        }
        fails.delete(key)
        return startSession(req, res, headers, rows[0])
      }
      if (seg[2] === 'password' && method === 'POST') {
        const u = need()
        const b = await readJson(req)
        const current = typeof b.currentPassword === 'string' ? b.currentPassword : ''
        const next = typeof b.newPassword === 'string' ? b.newPassword : ''
        if (next.length < 8 || next.length > 200) throw new HttpError(400, '새 비밀번호는 8~200자여야 합니다.')
        const { rows } = await pool.query('select password_hash from app_users where id = $1', [u.id])
        if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) throw new HttpError(400, '현재 비밀번호가 올바르지 않습니다.')
        if (next === current) throw new HttpError(400, '새 비밀번호는 현재 비밀번호와 달라야 합니다.')
        await pool.query('update app_users set password_hash = $1, must_change_password = false where id = $2', [await hashPassword(next), u.id])
        const token = parseCookies(req)[COOKIE]
        await pool.query('delete from app_sessions where user_id = $1 and token_hash <> $2', [u.id, sha256(token ?? '')]) // 다른 기기의 로그인은 끊는다
        return reply(res, headers, 200, { ok: true })
      }
      throw new HttpError(seg[2] ? 405 : 404, '지원하지 않는 요청입니다.')
    }

    // ===== 사용자 관리 (관리자) =====
    if (seg[1] === 'users') {
      const admin = need('admin')
      if (seg.length === 2 && method === 'GET') {
        const { rows } = await pool.query(
          `select u.id, u.username, u.name, u.role, u.active, u.client_id, u.is_sample, u.created_at, u.must_change_password,
                  (select count(*)::int from app_clients c where c.owner = u.id) as client_count,
                  (select name from app_clients c where c.id = u.client_id) as client_name
             from app_users u order by u.created_at asc`,
        )
        return reply(res, headers, 200, rows.map((r) => ({ ...userOut(r), active: r.active, isSample: r.is_sample, createdAt: r.created_at.toISOString(), clientCount: r.client_count, clientName: r.client_name ?? '' })))
      }
      if (seg.length === 2 && method === 'POST') {
        const b = await readJson(req)
        const { username, password } = newAccountInput(b)
        if (!ROLES.has(b.role)) throw new HttpError(400, '역할은 admin / consultant / client 중 하나여야 합니다.')
        const name = typeof b.name === 'string' ? b.name.trim() : ''
        if (!name || name.length > 100) throw new HttpError(400, '이름을 1~100자로 입력하세요.')
        let clientId = null
        if (b.role === 'client') {
          if (typeof b.clientId !== 'string' || !UUID_RE.test(b.clientId)) throw new HttpError(400, '고객 계정은 연결할 고객사를 선택해야 합니다.')
          const { rows } = await pool.query('select id from app_clients where id = $1', [b.clientId.toLowerCase()])
          if (!rows[0]) throw new HttpError(400, '연결할 고객사를 찾을 수 없습니다.')
          clientId = rows[0].id
        }
        try {
          const { rows } = await pool.query(
            'insert into app_users (username, name, role, client_id, password_hash, must_change_password) values ($1, $2, $3, $4, $5, true) returning id, username, name, role, client_id, active, created_at, must_change_password',
            [username, name, b.role, clientId, await hashPassword(password)],
          )
          return reply(res, headers, 201, { ...userOut(rows[0]), active: rows[0].active, createdAt: rows[0].created_at.toISOString() })
        } catch (e) {
          if (e.code === '23505') throw new HttpError(409, '이미 사용 중인 아이디입니다.')
          throw e
        }
      }
      if (seg.length === 3 && method === 'PATCH') {
        const id = uuidAt(2)
        const b = await readJson(req)
        const { rows } = await pool.query('select id, username, name, role, active, client_id from app_users where id = $1', [id])
        const target = rows[0]
        if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.')
        const next = { name: target.name, role: target.role, active: target.active, client_id: target.client_id }
        if (b.name !== undefined) {
          if (typeof b.name !== 'string' || b.name.length > 100) throw new HttpError(400, '이름은 100자 이하여야 합니다.')
          next.name = b.name.trim()
        }
        if (b.role !== undefined) {
          if (!ROLES.has(b.role)) throw new HttpError(400, '역할 값이 올바르지 않습니다.')
          next.role = b.role
        }
        if (b.active !== undefined) {
          if (typeof b.active !== 'boolean') throw new HttpError(400, 'active 는 true/false 여야 합니다.')
          next.active = b.active
        }
        if (b.clientId !== undefined) {
          if (b.clientId === null) next.client_id = null
          else {
            if (typeof b.clientId !== 'string' || !UUID_RE.test(b.clientId)) throw new HttpError(400, 'clientId 형식이 올바르지 않습니다.')
            const c = await pool.query('select id from app_clients where id = $1', [b.clientId.toLowerCase()])
            if (!c.rows[0]) throw new HttpError(400, '연결할 고객사를 찾을 수 없습니다.')
            next.client_id = c.rows[0].id
          }
        }
        if (next.role !== 'client') next.client_id = null
        else if (!next.client_id) throw new HttpError(400, '고객 계정은 연결할 고객사를 선택해야 합니다.')
        // 자기 자신의 역할·활성 상태는 바꿀 수 없다(관리자가 없어지는 사고 방지)
        if (id === admin.id && (next.role !== target.role || next.active !== target.active)) throw new HttpError(400, '자신의 역할이나 활성 상태는 바꿀 수 없습니다.')
        if (target.role === 'admin' && target.active && (next.role !== 'admin' || !next.active) && (await activeAdmins()) <= 1) {
          throw new HttpError(400, '마지막 관리자는 강등하거나 비활성화할 수 없습니다.')
        }
        let passwordHash = null
        if (b.password !== undefined) {
          if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 200) throw new HttpError(400, '임시 비밀번호는 8~200자여야 합니다.')
          passwordHash = await hashPassword(b.password)
        }
        await pool.query(
          `update app_users set name = $2, role = $3, active = $4, client_id = $5, password_hash = coalesce($6, password_hash),
                              must_change_password = case when $6::text is null then must_change_password else true end where id = $1`,
          [id, next.name, next.role, next.active, next.client_id, passwordHash],
        )
        if (passwordHash || !next.active) await pool.query('delete from app_sessions where user_id = $1', [id]) // 비밀번호 재설정·비활성화 시 로그인 해제
        const { rows: out } = await pool.query('select id, username, name, role, client_id, active, created_at, must_change_password from app_users where id = $1', [id])
        return reply(res, headers, 200, { ...userOut(out[0]), active: out[0].active, createdAt: out[0].created_at.toISOString() })
      }
      if (seg.length === 3 && method === 'DELETE') {
        const id = uuidAt(2)
        if (id === admin.id) throw new HttpError(400, '자기 자신은 삭제할 수 없습니다.')
        const { rows } = await pool.query('select role, active from app_users where id = $1', [id])
        if (!rows[0]) return reply(res, headers, 200, { ok: true })
        if (rows[0].role === 'admin' && rows[0].active && (await activeAdmins()) <= 1) throw new HttpError(400, '마지막 관리자는 삭제할 수 없습니다.')
        const owned = await pool.query('select count(*)::int as n from app_clients where owner = $1', [id])
        if (owned.rows[0].n > 0) throw new HttpError(409, '이 사용자의 고객사가 있어 삭제할 수 없습니다. 비활성화하거나 고객사를 다른 컨설턴트에게 넘기세요.')
        await pool.query('delete from app_users where id = $1', [id])
        return reply(res, headers, 200, { ok: true })
      }
      throw new HttpError(405, '지원하지 않는 요청입니다.')
    }

    // ===== 고객사 =====
    if (seg[1] === 'clients') {
      if (seg.length === 2 && method === 'GET') {
        const u = need()
        let q
        if (u.role === 'admin') q = await pool.query(`${CLIENT_SELECT} order by c.created_at desc`)
        else if (u.role === 'consultant') q = await pool.query(`${CLIENT_SELECT} where c.owner = $1 order by c.created_at desc`, [u.id])
        else q = await pool.query(`${CLIENT_SELECT} where c.id = $1`, [u.client_id ?? '00000000-0000-0000-0000-000000000000'])
        return reply(res, headers, 200, q.rows.map(clientOut))
      }
      // 엑셀 일괄 가져오기: 한 건이라도 오류가 있으면 아무것도 저장하지 않는다
      if (seg.length === 3 && seg[2] === 'import' && method === 'POST') {
        const u = need('admin', 'consultant')
        const b = await readJson(req)
        if (!Array.isArray(b.clients) || b.clients.length === 0 || b.clients.length > IMPORT_MAX_ROWS) throw new HttpError(400, `고객사는 1~${IMPORT_MAX_ROWS}건이어야 합니다.`)
        const errors = []
        const rows = []
        for (let i = 0; i < b.clients.length; i++) {
          const r = b.clients[i]
          try {
            if (!isObj(r)) throw new HttpError(400, '행 형식이 올바르지 않습니다.')
            const v = validateClientBody(r)
            let id = null
            if (r.id !== undefined && r.id !== null && r.id !== '') {
              if (typeof r.id !== 'string' || !UUID_RE.test(r.id)) throw new HttpError(400, 'ID 형식이 올바르지 않습니다.')
              id = r.id.toLowerCase()
            }
            let ownerId = u.id
            if (r.ownerId !== undefined && r.ownerId !== null && r.ownerId !== '') {
              if (u.role !== 'admin') throw new HttpError(403, '담당 컨설턴트는 관리자만 지정할 수 있습니다.')
              ownerId = await assertOwnerCandidate(r.ownerId)
            }
            rows.push({ ...v, id, ownerId, explicitOwner: u.role === 'admin' && r.ownerId })
          } catch (e) {
            if (!(e instanceof HttpError)) throw e
            errors.push({ row: i + 1, message: e.message })
          }
        }
        if (errors.length) throw new HttpError(400, '가져올 수 없는 행이 있습니다.', errors.slice(0, 50))
        const c = await pool.connect()
        let created = 0
        let updated = 0
        try {
          await c.query('begin')
          for (const r of rows) {
            let existing = null
            if (r.id) existing = (await c.query('select owner from app_clients where id = $1', [r.id])).rows[0] ?? null
            if (existing) {
              if (u.role !== 'admin' && existing.owner !== u.id) throw new HttpError(409, '이미 다른 사용자가 사용 중인 ID 입니다.')
              await c.query('update app_clients set name = $2, profile = $3::jsonb, owner = $4 where id = $1', [r.id, r.name, JSON.stringify(r.profile), r.explicitOwner ? r.ownerId : existing.owner])
              if (r.explicitOwner) await c.query('update app_diagnoses set owner = $2 where client_id = $1', [r.id, r.ownerId])
              updated++
            } else {
              await c.query('insert into app_clients (id, owner, name, profile, created_at) values ($1, $2, $3, $4::jsonb, $5)', [r.id ?? randomUUID(), r.ownerId, r.name, JSON.stringify(r.profile), r.createdAt])
              created++
            }
          }
          await c.query('commit')
        } catch (e) {
          await c.query('rollback').catch(() => {})
          throw e
        } finally {
          c.release()
        }
        return reply(res, headers, 200, { created, updated })
      }
      if (seg.length === 3 && method === 'PUT') {
        const u = need('admin', 'consultant')
        const id = uuidAt(2)
        const b = await readJson(req)
        const v = validateClientBody(b)
        let q
        if (u.role === 'admin') {
          const hasOwner = b.ownerId !== undefined && b.ownerId !== null && b.ownerId !== ''
          const ownerId = hasOwner ? await assertOwnerCandidate(b.ownerId) : null
          q = await pool.query(
            `insert into app_clients (id, owner, name, profile, created_at) values ($1, coalesce($5::uuid, $2::uuid), $3, $4::jsonb, $6)
             on conflict (id) do update set name = excluded.name, profile = excluded.profile, owner = coalesce($5::uuid, app_clients.owner)
             returning id, owner`,
            [id, u.id, v.name, JSON.stringify(v.profile), ownerId, v.createdAt],
          )
          if (ownerId) await pool.query('update app_diagnoses set owner = $2 where client_id = $1', [id, ownerId])
        } else {
          q = await pool.query(
            `insert into app_clients (id, owner, name, profile, created_at) values ($1, $2, $3, $4::jsonb, $5)
             on conflict (id) do update set name = excluded.name, profile = excluded.profile
             where app_clients.owner = excluded.owner
             returning id, owner`,
            [id, u.id, v.name, JSON.stringify(v.profile), v.createdAt],
          )
        }
        if (!q.rows[0]) throw new HttpError(409, '이미 사용 중인 ID 입니다.')
        const { rows } = await pool.query(`${CLIENT_SELECT} where c.id = $1`, [id])
        return reply(res, headers, 200, clientOut(rows[0]))
      }
      if (seg.length === 3 && method === 'DELETE') {
        const u = need('admin', 'consultant')
        const id = uuidAt(2)
        if (u.role === 'admin') await pool.query('delete from app_clients where id = $1', [id])
        else await pool.query('delete from app_clients where id = $1 and owner = $2', [id, u.id])
        return reply(res, headers, 200, { ok: true })
      }
      throw new HttpError(405, '지원하지 않는 요청입니다.')
    }

    // ===== 진단 =====
    if (seg[1] === 'diagnoses') {
      if (seg.length === 2 && method === 'GET') {
        const u = need()
        let q
        if (u.role === 'admin') q = await pool.query('select * from app_diagnoses order by updated_at desc')
        else if (u.role === 'consultant') q = await pool.query('select * from app_diagnoses where owner = $1 order by updated_at desc', [u.id])
        else q = await pool.query(`select * from app_diagnoses where client_id = $1 and status = 'completed' order by updated_at desc`, [u.client_id ?? '00000000-0000-0000-0000-000000000000'])
        return reply(res, headers, 200, q.rows.map(diagOut))
      }
      if (seg.length === 3 && method === 'PUT') {
        const u = need('admin', 'consultant')
        const id = uuidAt(2)
        const b = await readJson(req)
        if (typeof b.clientId !== 'string' || !UUID_RE.test(b.clientId)) throw new HttpError(400, 'clientId 형식이 올바르지 않습니다.')
        if (typeof b.domain !== 'string' || !DOMAIN_RE.test(b.domain)) throw new HttpError(400, 'domain 형식이 올바르지 않습니다.')
        if (!isObj(b.answers) || !isObj(b.notes)) throw new HttpError(400, 'answers 와 notes 는 객체여야 합니다.')
        if (Object.keys(b.answers).length > 2000 || Object.keys(b.notes).length > 2000) throw new HttpError(400, '항목이 너무 많습니다.')
        if (!STATUSES.has(b.status)) throw new HttpError(400, 'status 값이 올바르지 않습니다.')
        const mode = b.mode === undefined ? 'full' : b.mode
        if (!MODES.has(mode)) throw new HttpError(400, 'mode 는 full 또는 quick 이어야 합니다.')
        const created = validDate(b.createdAt) ?? new Date()
        const updated = validDate(b.updatedAt) ?? new Date()
        // 진단의 소유자는 고객사의 담당자다. 컨설턴트는 자기 고객사에만, 관리자는 모든 고객사에 쓸 수 있다.
        const cl = await pool.query('select owner from app_clients where id = $1', [b.clientId.toLowerCase()])
        if (!cl.rows[0] || (u.role !== 'admin' && cl.rows[0].owner !== u.id)) throw new HttpError(404, '고객사를 찾을 수 없습니다.')
        const guard = u.role === 'admin' ? '' : 'where app_diagnoses.owner = excluded.owner'
        const { rows } = await pool.query(
          `insert into app_diagnoses (id, owner, client_id, domain, answers, notes, status, mode, created_at, updated_at)
           values ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6::jsonb, $7, $10, $8, $9)
           on conflict (id) do update set domain = excluded.domain, answers = excluded.answers, notes = excluded.notes,
             status = excluded.status, mode = excluded.mode, updated_at = excluded.updated_at
           ${guard}
           returning *`,
          [id, cl.rows[0].owner, b.clientId.toLowerCase(), b.domain, JSON.stringify(b.answers), JSON.stringify(b.notes), b.status, created, updated, mode],
        )
        if (!rows[0]) throw new HttpError(404, '진단을 찾을 수 없습니다.')
        return reply(res, headers, 200, diagOut(rows[0]))
      }
      if (seg.length === 3 && method === 'DELETE') {
        const u = need('admin', 'consultant')
        const id = uuidAt(2)
        if (u.role === 'admin') await pool.query('delete from app_diagnoses where id = $1', [id])
        else await pool.query('delete from app_diagnoses where id = $1 and owner = $2', [id, u.id])
        return reply(res, headers, 200, { ok: true })
      }
      throw new HttpError(405, '지원하지 않는 요청입니다.')
    }

    // ===== 체크리스트(관리자가 수정한 내용). 저장된 것이 없는 분야는 앱에 들어 있는 원본을 쓴다 =====
    if (seg[1] === 'checklists') {
      if (seg.length === 2 && method === 'GET') {
        need()
        const { rows } = await pool.query(
          `select c.domain, c.data, c.updated_at, u.name as updated_by_name, u.username as updated_by_username
             from app_checklists c left join app_users u on u.id = c.updated_by`,
        )
        const overrides = {}
        for (const r of rows) overrides[r.domain] = { data: r.data, updatedAt: r.updated_at.toISOString(), updatedBy: r.updated_by_name || r.updated_by_username || '' }
        return reply(res, headers, 200, { overrides })
      }
      if (seg.length === 3) {
        const admin = need('admin')
        const domain = seg[2]
        if (!DOMAIN_RE.test(domain)) throw new HttpError(400, '분야 이름이 올바르지 않습니다.')
        if (method === 'PUT') {
          const b = await readJson(req)
          const errors = validateChecklist(domain, b.data)
          if (errors.length) throw new HttpError(400, '체크리스트 형식이 올바르지 않습니다.', errors)
          await pool.query(
            `insert into app_checklists (domain, data, updated_at, updated_by) values ($1, $2::jsonb, now(), $3)
             on conflict (domain) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by`,
            [domain, JSON.stringify(b.data), admin.id],
          )
          return reply(res, headers, 200, { ok: true })
        }
        if (method === 'DELETE') {
          await pool.query('delete from app_checklists where domain = $1', [domain])
          return reply(res, headers, 200, { ok: true })
        }
      }
      throw new HttpError(405, '지원하지 않는 요청입니다.')
    }

    // ===== 샘플 데이터 (관리자) =====
    if (seg[1] === 'admin' && seg[2] === 'sample') {
      const admin = need('admin')
      if (seg.length === 3 && method === 'GET') return reply(res, headers, 200, await sampleStatus(pool))
      if (seg.length === 3 && method === 'POST') {
        const r = await seedSample(pool, admin.id)
        return reply(res, headers, 200, r)
      }
      if (seg.length === 3 && method === 'DELETE') return reply(res, headers, 200, await removeSample(pool))
      if (seg.length === 4 && seg[3] === 'accounts' && method === 'POST') {
        try {
          return reply(res, headers, 200, await createSampleAccounts(pool, hashPassword))
        } catch (e) {
          if (e.httpStatus) throw new HttpError(e.httpStatus, e.message)
          throw e
        }
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
      // 관리자가 만들어 준 임시 비밀번호로 처음 로그인했다면, 비밀번호를 바꾸기 전에는 아무것도 할 수 없다
      if (user?.must_change_password && !['/api/auth/me', '/api/auth/password', '/api/auth/logout'].includes(pathname)) {
        throw new HttpError(403, '처음 로그인했습니다. 비밀번호를 먼저 바꿔 주세요.')
      }
      await route(req, res, headers, pathname, user)
    } catch (err) {
      if (err instanceof HttpError) {
        const body = err.details ? { error: err.message, errors: err.details } : { error: err.message }
        return reply(res, headers, err.status, body, err.status === 413 ? { Connection: 'close' } : {})
      }
      console.error('API 오류', err)
      if (!res.headersSent) reply(res, headers, 500, { error: '서버 오류가 발생했습니다.' })
      else res.end()
    }
  }

  return { handle, pool, close: () => pool.end() }
}

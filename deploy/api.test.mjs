// Postgres API 테스트. TEST_DATABASE_URL 이 없으면 건너뛴다.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/semucheck_test node --test deploy/api.test.mjs
// 주의: 테스트는 app_* 테이블을 비우고 시작하므로 반드시 테스트용 DB 를 가리켜야 한다.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createApp } from './server.mjs'
import { bootstrapAdmin, createDbApi } from './api.mjs'
import { ensureSampleSeeded } from './sample.mjs'

const DB = process.env.TEST_DATABASE_URL
const skip = !DB
const PW = 'password123' // 본인이 바꾼 뒤의 비밀번호
const TEMP = 'temp-pass-123' // 관리자가 정해 준 임시 비밀번호

let dir, dbApi, server, url
let admin, kim, lee, clientUser // 클라이언트(쿠키 보관)
let kimClient // 김 컨설턴트의 고객사

const listen = (app) => new Promise((r) => app.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${app.address().port}`)))

/** 쿠키를 들고 다니는 아주 작은 클라이언트 */
function client(base) {
  let cookie = ''
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const set = r.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* JSON 아님 */ }
    return { status: r.status, json, headers: r.headers }
  }
  return { call, get cookie() { return cookie } }
}

const profile = { business_type: '법인', business_age: 3, employees: 80, bookkeeping: '복식부기', has_research_lab: false, has_venture: false, planning_job_invention: false, industry: '제조업(C)' }
const mkClient = (name = '(주)테스트') => ({ id: randomUUID(), name, profile, createdAt: new Date().toISOString() })
const mkDiag = (clientId, over = {}) => ({ id: randomUUID(), clientId, domain: 'labor', answers: { 'LAB-001': '예' }, notes: {}, status: 'in_progress', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over })
const riskItem = (over = {}) => ({ id: 'T-001', domain: 'labor', category: '시험', question: '시험 문항입니까?', answer_type: 'yes_no', risk_rule: "answer == '아니오'", signal: 'yellow', risk_level: 'medium', recommendation: '권고', ...over })

async function login(base, username, password = PW) {
  const c = client(base)
  const r = await c.call('POST', '/api/auth/login', { username, password })
  assert.equal(r.status, 200, `${username} 로그인 ${r.status} ${JSON.stringify(r.json)}`)
  return c
}
/** 관리자가 계정을 만들면 임시 비밀번호(TEMP)로 시작한다. 이 도우미는 첫 로그인과 비밀번호 변경까지 마쳐서(PW) 바로 쓸 수 있게 한다. */
async function mkUser(adminC, role, name, extra = {}) {
  const username = `${role}-${randomUUID().slice(0, 8)}`
  const r = await adminC.call('POST', '/api/users', { username, name, role, password: TEMP, ...extra })
  assert.equal(r.status, 201, JSON.stringify(r.json))
  const c = await login(url, username, TEMP)
  assert.equal((await c.call('POST', '/api/auth/password', { currentPassword: TEMP, newPassword: PW })).status, 200)
  return { username, id: r.json.id }
}

before(async () => {
  if (skip) return
  dir = mkdtempSync(path.join(tmpdir(), 'semucheck-api-'))
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'index.html'), '<div id="root"></div>')
  dbApi = await createDbApi({ connectionString: DB })
  await dbApi.pool.query('truncate app_users cascade')
  await dbApi.pool.query('truncate app_checklists, app_meta')
  server = createApp({ staticDir: dir, api: dbApi })
  url = await listen(server)

  // 계정이 하나도 없으면 최초 관리자가 만들어진다(임시 비밀번호 → 첫 로그인에서 변경)
  await bootstrapAdmin(dbApi.pool, { adminUsername: 'admin', adminPassword: TEMP })
  await ensureSampleSeeded(dbApi.pool)
  admin = await login(url, 'admin', TEMP)
  assert.equal((await admin.call('POST', '/api/auth/password', { currentPassword: TEMP, newPassword: PW })).status, 200)
  const k = await mkUser(admin, 'consultant', '김컨설턴트')
  const l = await mkUser(admin, 'consultant', '이컨설턴트')
  kim = { ...k, c: await login(url, k.username) }
  lee = { ...l, c: await login(url, l.username) }
  kimClient = mkClient('(주)김의고객')
  assert.equal((await kim.c.call('PUT', `/api/clients/${kimClient.id}`, kimClient)).status, 200)
  const cu = await mkUser(admin, 'client', '고객 담당자', { clientId: kimClient.id })
  clientUser = { ...cu, c: await login(url, cu.username) }
})
after(async () => {
  if (skip) return
  server.close()
  await dbApi.close()
  rmSync(dir, { recursive: true, force: true })
})

test('DB 없이 기동하면 /api/health 는 db:false', async () => {
  const d = mkdtempSync(path.join(tmpdir(), 'semucheck-nodb-'))
  writeFileSync(path.join(d, 'index.html'), 'x')
  const app = createApp({ staticDir: d })
  const u = await listen(app)
  assert.deepEqual(await (await fetch(u + '/api/health')).json(), { ok: true, db: false })
  assert.equal((await fetch(u + '/api/clients')).status, 404)
  app.close()
})

// ---------------- 가입·로그인 ----------------
test('인증 없이 데이터·관리 API 는 401', { skip }, async () => {
  const c = client(url)
  for (const [m, p] of [['GET', '/api/clients'], ['GET', '/api/diagnoses'], ['GET', '/api/users'], ['GET', '/api/checklists'], ['GET', '/api/admin/sample'], ['PUT', `/api/clients/${randomUUID()}`], ['DELETE', `/api/diagnoses/${randomUUID()}`]]) {
    assert.equal((await c.call(m, p, m === 'PUT' ? mkClient() : undefined)).status, 401, `${m} ${p}`)
  }
  assert.deepEqual((await c.call('GET', '/api/auth/me')).json, { user: null })
})

test('가입 API 는 없다 — 누구도 스스로 계정을 만들 수 없다', { skip }, async () => {
  const c = client(url)
  const r = await c.call('POST', '/api/auth/signup', { username: 'hacker', name: '가', password: PW })
  assert.ok([404, 405].includes(r.status), `signup → ${r.status}`)
  assert.equal((await dbApi.pool.query("select count(*)::int as n from app_users where username = 'hacker'")).rows[0].n, 0)
})

/** 임시 스키마에서 빈 DB 를 흉내 내 실행한다 */
async function withEmptyDb(fn) {
  const pg = (await import('pg')).default
  const sch = `boot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const root = new pg.Pool({ connectionString: DB })
  await root.query(`create schema ${sch}`)
  const pool = new pg.Pool({ connectionString: DB, options: `-c search_path=${sch}` })
  try {
    await fn(pool)
  } finally {
    await pool.end().catch(() => {})
    await root.query(`drop schema ${sch} cascade`)
    await root.end()
  }
}

test('최초 관리자: 임시 비밀번호로 시작하고, 바꾸기 전에는 다른 API 를 쓸 수 없다', { skip }, async () => {
  await withEmptyDb(async (pool) => {
    const api = await createDbApi({ pool, adminUsername: 'Boss', adminPassword: 'first-pass-123' })
    const app = createApp({ staticDir: dir, api })
    const u = await listen(app)
    try {
      assert.equal((await pool.query('select count(*)::int as n from app_users')).rows[0].n, 1)
      const c = await login(u, 'BOSS', 'first-pass-123') // 아이디는 대소문자를 구분하지 않는다
      const me = (await c.call('GET', '/api/auth/me')).json.user
      assert.deepEqual({ username: me.username, role: me.role, mustChangePassword: me.mustChangePassword }, { username: 'boss', role: 'admin', mustChangePassword: true })
      for (const [m, p] of [['GET', '/api/clients'], ['GET', '/api/users'], ['GET', '/api/checklists'], ['GET', '/api/diagnoses']]) {
        const r = await c.call(m, p)
        assert.equal(r.status, 403, `${m} ${p}`)
        assert.match(r.json.error, /비밀번호를 먼저/)
      }
      assert.equal((await c.call('POST', '/api/auth/password', { currentPassword: 'first-pass-123', newPassword: 'first-pass-123' })).status, 400) // 같은 비밀번호 불가
      assert.equal((await c.call('POST', '/api/auth/password', { currentPassword: 'first-pass-123', newPassword: 'my-own-pass-1' })).status, 200)
      assert.equal((await c.call('GET', '/api/auth/me')).json.user.mustChangePassword, false)
      assert.equal((await c.call('GET', '/api/clients')).status, 200)
      // 계정이 이미 있으면 다시 만들지 않는다
      await bootstrapAdmin(pool, { adminUsername: 'other', adminPassword: 'whatever-123' })
      assert.equal((await pool.query('select count(*)::int as n from app_users')).rows[0].n, 1)
    } finally {
      app.close()
    }
  })
})

test('최초 관리자 비밀번호를 정하지 않으면 무작위 임시 비밀번호를 로그에 한 번 출력한다', { skip }, async () => {
  await withEmptyDb(async (pool) => {
    const logs = []
    const orig = console.log
    console.log = (...a) => logs.push(a.join(' '))
    try {
      await createDbApi({ pool })
    } finally {
      console.log = orig
    }
    const line = logs.find((l) => l.includes('임시 비밀번호'))
    const pw = line?.match(/임시 비밀번호: (\S+)/)?.[1]
    assert.match(pw ?? '', /^[A-Za-z0-9_-]{12}$/)
    assert.match(line, /아이디: admin/)
    const row = (await pool.query("select must_change_password from app_users where username = 'admin'")).rows[0]
    assert.equal(row.must_change_password, true)
    // 잘못된 설정은 시작 실패
    await pool.query('truncate app_users cascade')
    await assert.rejects(bootstrapAdmin(pool, { adminUsername: 'a b', adminPassword: 'abcdefgh1' }), /ADMIN_USERNAME/)
    await assert.rejects(bootstrapAdmin(pool, { adminUsername: 'admin', adminPassword: 'short' }), /8자/)
  })
})

test('관리자 비밀번호 분실 복구(ADMIN_RESET): 비밀번호를 되돌리고 첫 로그인에서 다시 바꾸게 한다', { skip }, async () => {
  const c = await login(url, 'admin')
  await bootstrapAdmin(dbApi.pool, { adminUsername: 'admin', adminPassword: 'recovered-pass-1', resetAdmin: true })
  assert.equal((await c.call('GET', '/api/clients')).status, 401) // 기존 로그인 해제
  assert.equal((await client(url).call('POST', '/api/auth/login', { username: 'admin', password: PW })).status, 401)
  const again = await login(url, 'admin', 'recovered-pass-1')
  assert.equal((await again.call('GET', '/api/auth/me')).json.user.mustChangePassword, true)
  assert.equal((await again.call('POST', '/api/auth/password', { currentPassword: 'recovered-pass-1', newPassword: PW })).status, 200)
  admin = await login(url, 'admin') // 이후 테스트에서 쓸 관리자 클라이언트로 교체
})

test('첫 관리자 계정에도 샘플 데이터가 한 번 들어간다', { skip }, async () => {
  const me = (await admin.call('GET', '/api/auth/me')).json.user
  assert.equal(me.role, 'admin')
  const s = (await admin.call('GET', '/api/admin/sample')).json
  assert.equal(s.clientCount, 3)
  assert.equal(s.diagnosisCount, 9)
  const clients = (await admin.call('GET', '/api/clients')).json
  assert.equal(clients.filter((c) => c.isSample).length, 3)
  assert.ok(clients.find((c) => c.name.includes('한빛정밀')))
})

test('비밀번호는 scrypt 해시, 세션 토큰은 해시로만 저장', { skip }, async () => {
  const { rows } = await dbApi.pool.query("select password_hash from app_users where username = 'admin'")
  assert.match(rows[0].password_hash, /^scrypt\$16384\$8\$1\$/)
  assert.doesNotMatch(rows[0].password_hash, /password123/)
  assert.match((await dbApi.pool.query('select token_hash from app_sessions limit 1')).rows[0].token_hash, /^[0-9a-f]{64}$/)
})

test('로그인·로그아웃·me(이름·역할)', { skip }, async () => {
  const c = client(url)
  const bad = await c.call('POST', '/api/auth/login', { username: 'admin', password: 'wrong-password' })
  assert.equal(bad.status, 401)
  assert.match(bad.json.error, /아이디 또는 비밀번호/)
  assert.equal((await c.call('POST', '/api/auth/login', { username: 'nobody', password: PW })).status, 401)
  assert.equal((await c.call('POST', '/api/auth/login', { username: '', password: PW })).status, 400)
  const ok = await c.call('POST', '/api/auth/login', { username: 'ADMIN', password: PW })
  assert.equal(ok.status, 200)
  assert.deepEqual({ role: ok.json.user.role, name: ok.json.user.name, username: ok.json.user.username }, { role: 'admin', name: '관리자', username: 'admin' })
  assert.equal((await c.call('POST', '/api/auth/logout', {})).status, 200)
  assert.equal((await c.call('GET', '/api/clients')).status, 401)
})

test('로그인 실패가 반복되면 429', { skip }, async () => {
  const c = client(url)
  let last = 0
  for (let i = 0; i < 12; i++) last = (await c.call('POST', '/api/auth/login', { username: 'brute', password: `bad-${i}` })).status
  assert.equal(last, 429)
})

// ---------------- 사용자 관리 ----------------
test('사용자 관리는 관리자만: 컨설턴트·고객은 403', { skip }, async () => {
  for (const u of [kim, clientUser]) {
    assert.equal((await u.c.call('GET', '/api/users')).status, 403)
    assert.equal((await u.c.call('POST', '/api/users', { username: 'zzz', name: '가', role: 'admin', password: TEMP })).status, 403)
    assert.equal((await u.c.call('PATCH', `/api/users/${kim.id}`, { role: 'admin' })).status, 403)
    assert.equal((await u.c.call('DELETE', `/api/users/${lee.id}`)).status, 403)
    assert.equal((await u.c.call('GET', '/api/admin/sample')).status, 403)
  }
})

test('사용자 생성 검증: 역할·이름·고객 연결·중복', { skip }, async () => {
  const base = { username: `v-${randomUUID().slice(0, 6)}`, name: '검증', password: TEMP }
  assert.equal((await admin.call('POST', '/api/users', { ...base, role: 'superuser' })).status, 400)
  assert.equal((await admin.call('POST', '/api/users', { ...base, name: '', role: 'consultant' })).status, 400)
  assert.equal((await admin.call('POST', '/api/users', { ...base, role: 'client' })).status, 400) // 연결할 고객사 필요
  assert.equal((await admin.call('POST', '/api/users', { ...base, role: 'client', clientId: randomUUID() })).status, 400)
  assert.equal((await admin.call('POST', '/api/users', { ...base, role: 'consultant', password: 'short' })).status, 400)
  assert.equal((await admin.call('POST', '/api/users', { ...base, username: kim.username.toUpperCase(), role: 'consultant' })).status, 409) // 대소문자만 달라도 중복
  for (const bad of ['ab', 'has space', 'kim@example.com', '한글아이디', '-start', 'x'.repeat(31), '']) {
    const r = await admin.call('POST', '/api/users', { ...base, username: bad, role: 'consultant' })
    assert.equal(r.status, 400, `아이디 "${bad}"`)
    assert.match(r.json.error, /아이디/)
  }
  const list = (await admin.call('GET', '/api/users')).json
  assert.ok(list.find((u) => u.username === kim.username && u.role === 'consultant' && u.clientCount === 1))
  assert.ok(list.find((u) => u.username === clientUser.username && u.clientName === '(주)김의고객'))
  assert.equal(list.some((u) => 'password' in u || 'password_hash' in u || 'passwordHash' in u), false)
})

test('역할 변경은 즉시 적용되고, 비활성화하면 로그인이 풀린다', { skip }, async () => {
  const u = await mkUser(admin, 'consultant', '임시')
  const c = await login(url, u.username)
  assert.equal((await c.call('GET', '/api/users')).status, 403)
  assert.equal((await admin.call('PATCH', `/api/users/${u.id}`, { role: 'admin' })).status, 200)
  assert.equal((await c.call('GET', '/api/users')).status, 200) // 세션은 그대로, 권한만 바뀜
  assert.equal((await admin.call('PATCH', `/api/users/${u.id}`, { role: 'consultant' })).status, 200)
  assert.equal((await c.call('GET', '/api/users')).status, 403)
  assert.equal((await admin.call('PATCH', `/api/users/${u.id}`, { active: false })).status, 200)
  assert.equal((await c.call('GET', '/api/clients')).status, 401) // 로그인 해제
  assert.equal((await client(url).call('POST', '/api/auth/login', { username: u.username, password: PW })).status, 401) // 비활성은 로그인 불가
  assert.equal((await admin.call('PATCH', `/api/users/${u.id}`, { active: true })).status, 200)
  await login(url, u.username)
})

test('비밀번호 재설정: 기존 비밀번호·세션은 무효', { skip }, async () => {
  const u = await mkUser(admin, 'consultant', '재설정')
  const old = await login(url, u.username)
  assert.equal((await admin.call('PATCH', `/api/users/${u.id}`, { password: 'short' })).status, 400)
  assert.equal((await admin.call('PATCH', `/api/users/${u.id}`, { password: 'new-password-1' })).status, 200)
  assert.equal((await old.call('GET', '/api/clients')).status, 401)
  assert.equal((await client(url).call('POST', '/api/auth/login', { username: u.username, password: PW })).status, 401)
  // 관리자가 정해 준 비밀번호는 임시 비밀번호다: 로그인은 되지만 본인이 바꾸기 전에는 쓸 수 없다
  const fresh = await login(url, u.username, 'new-password-1')
  assert.equal((await fresh.call('GET', '/api/auth/me')).json.user.mustChangePassword, true)
  assert.equal((await fresh.call('GET', '/api/clients')).status, 403)
  assert.equal((await fresh.call('POST', '/api/auth/password', { currentPassword: 'new-password-1', newPassword: 'my-final-pass-1' })).status, 200)
  assert.equal((await fresh.call('GET', '/api/clients')).status, 200)
})

test('안전장치: 자기 자신 변경 불가, 마지막 관리자 보호, 고객사가 있는 사용자는 삭제 불가', { skip }, async () => {
  const me = (await admin.call('GET', '/api/auth/me')).json.user
  assert.equal((await admin.call('PATCH', `/api/users/${me.id}`, { role: 'consultant' })).status, 400)
  assert.equal((await admin.call('PATCH', `/api/users/${me.id}`, { active: false })).status, 400)
  assert.equal((await admin.call('DELETE', `/api/users/${me.id}`)).status, 400)
  // 관리자 한 명 더 만들어 마지막 관리자 보호 확인
  const a2 = await mkUser(admin, 'admin', '두번째 관리자')
  const a2c = await login(url, a2.username)
  assert.equal((await admin.call('PATCH', `/api/users/${a2.id}`, { role: 'consultant' })).status, 200)
  assert.equal((await admin.call('PATCH', `/api/users/${a2.id}`, { role: 'admin' })).status, 200)
  assert.equal((await a2c.call('PATCH', `/api/users/${me.id}`, { role: 'consultant' })).status, 200) // 두 명이면 강등 가능
  assert.equal((await a2c.call('PATCH', `/api/users/${me.id}`, { role: 'admin' })).status, 200)
  // 마지막 관리자(비활성 포함 계산): 샘플 외 관리자를 하나만 남기는 경우
  await admin.call('PATCH', `/api/users/${a2.id}`, { active: false })
  assert.equal((await dbApi.pool.query("select count(*)::int as n from app_users where role='admin' and active")).rows[0].n, 1)
  assert.equal((await a2c.call('GET', '/api/users')).status, 401)
  // 고객사가 있는 컨설턴트는 삭제 불가
  assert.equal((await admin.call('DELETE', `/api/users/${kim.id}`)).status, 409)
  const empty = await mkUser(admin, 'consultant', '삭제대상')
  assert.equal((await admin.call('DELETE', `/api/users/${empty.id}`)).status, 200)
  assert.equal((await admin.call('GET', '/api/users')).json.some((u) => u.id === empty.id), false)
})

test('내 비밀번호 변경: 현재 비밀번호 확인, 다른 기기 로그인은 해제', { skip }, async () => {
  const u = await mkUser(admin, 'consultant', '비번변경')
  const a = await login(url, u.username)
  const b = await login(url, u.username)
  assert.equal((await a.call('POST', '/api/auth/password', { currentPassword: 'wrong-password', newPassword: 'changed-pass-1' })).status, 400)
  assert.equal((await a.call('POST', '/api/auth/password', { currentPassword: PW, newPassword: 'short' })).status, 400)
  assert.equal((await a.call('POST', '/api/auth/password', { currentPassword: PW, newPassword: 'changed-pass-1' })).status, 200)
  assert.equal((await a.call('GET', '/api/clients')).status, 200) // 지금 기기는 유지
  assert.equal((await b.call('GET', '/api/clients')).status, 401) // 다른 기기는 해제
  await login(url, u.username, 'changed-pass-1')
})

// ---------------- 담당 고객사 범위 ----------------
test('컨설턴트는 자기 담당 고객사·진단만 보고, 관리자는 전부 본다', { skip }, async () => {
  const leeClient = mkClient('(주)이의고객')
  await lee.c.call('PUT', `/api/clients/${leeClient.id}`, leeClient)
  const kd = mkDiag(kimClient.id)
  const ld = mkDiag(leeClient.id)
  assert.equal((await kim.c.call('PUT', `/api/diagnoses/${kd.id}`, kd)).status, 200)
  assert.equal((await lee.c.call('PUT', `/api/diagnoses/${ld.id}`, ld)).status, 200)

  const kimSees = (await kim.c.call('GET', '/api/clients')).json
  assert.ok(kimSees.some((c) => c.id === kimClient.id))
  assert.equal(kimSees.some((c) => c.id === leeClient.id), false)
  assert.equal(kimSees.some((c) => c.isSample), false) // 샘플은 관리자 소유
  assert.equal((await kim.c.call('GET', '/api/diagnoses')).json.some((d) => d.id === ld.id), false)

  const adminSees = (await admin.call('GET', '/api/clients')).json
  assert.ok(adminSees.some((c) => c.id === kimClient.id && c.ownerName === '김컨설턴트'))
  assert.ok(adminSees.some((c) => c.id === leeClient.id && c.ownerName === '이컨설턴트'))
  const adminDiags = (await admin.call('GET', '/api/diagnoses')).json
  assert.ok(adminDiags.some((d) => d.id === kd.id) && adminDiags.some((d) => d.id === ld.id))
})

test('다른 컨설턴트의 데이터는 덮어쓰기·삭제·진단 추가가 모두 막힌다', { skip }, async () => {
  const d = mkDiag(kimClient.id)
  await kim.c.call('PUT', `/api/diagnoses/${d.id}`, d)
  assert.equal((await lee.c.call('PUT', `/api/clients/${kimClient.id}`, { ...kimClient, name: '탈취' })).status, 409)
  assert.equal((await lee.c.call('PUT', `/api/diagnoses/${d.id}`, { ...d, status: 'completed' })).status, 404)
  assert.equal((await lee.c.call('PUT', `/api/diagnoses/${randomUUID()}`, mkDiag(kimClient.id))).status, 404)
  await lee.c.call('DELETE', `/api/clients/${kimClient.id}`)
  await lee.c.call('DELETE', `/api/diagnoses/${d.id}`)
  assert.ok((await kim.c.call('GET', '/api/clients')).json.some((c) => c.id === kimClient.id && c.name === '(주)김의고객'))
  assert.ok((await kim.c.call('GET', '/api/diagnoses')).json.some((x) => x.id === d.id))
})

test('관리자는 모든 고객사·진단을 수정·삭제할 수 있고 담당자를 바꾸면 보이는 범위가 따라간다', { skip }, async () => {
  const cl = mkClient('(주)이관대상')
  await kim.c.call('PUT', `/api/clients/${cl.id}`, cl)
  const d = mkDiag(cl.id)
  await kim.c.call('PUT', `/api/diagnoses/${d.id}`, d)
  // 관리자가 남의 고객사·진단을 수정
  assert.equal((await admin.call('PUT', `/api/clients/${cl.id}`, { ...cl, name: '(주)관리자수정' })).json.name, '(주)관리자수정')
  assert.equal((await admin.call('PUT', `/api/diagnoses/${d.id}`, { ...d, status: 'completed' })).json.status, 'completed')
  assert.equal((await kim.c.call('GET', '/api/diagnoses')).json.find((x) => x.id === d.id).status, 'completed')
  // 담당자 변경(김 → 이)
  const moved = await admin.call('PUT', `/api/clients/${cl.id}`, { ...cl, name: '(주)관리자수정', ownerId: lee.id })
  assert.equal(moved.json.ownerId, lee.id)
  assert.equal((await kim.c.call('GET', '/api/clients')).json.some((c) => c.id === cl.id), false)
  assert.equal((await kim.c.call('GET', '/api/diagnoses')).json.some((x) => x.id === d.id), false)
  assert.ok((await lee.c.call('GET', '/api/clients')).json.some((c) => c.id === cl.id))
  assert.ok((await lee.c.call('GET', '/api/diagnoses')).json.some((x) => x.id === d.id))
  // 컨설턴트는 담당자를 지정해도 무시되고 자기 것으로 유지
  const own = mkClient('(주)자기것')
  const r = await kim.c.call('PUT', `/api/clients/${own.id}`, { ...own, ownerId: lee.id })
  assert.equal(r.json.ownerId, kim.id)
  // 담당자 후보는 활성 관리자·컨설턴트만
  assert.equal((await admin.call('PUT', `/api/clients/${cl.id}`, { ...cl, ownerId: clientUser.id })).status, 400)
  // 관리자가 삭제
  assert.equal((await admin.call('DELETE', `/api/clients/${cl.id}`)).status, 200)
  assert.equal((await admin.call('GET', '/api/diagnoses')).json.some((x) => x.id === d.id), false)
})

// ---------------- 고객(읽기 전용) ----------------
test('고객 계정은 자기 회사의 완료된 진단만 보고 아무것도 수정할 수 없다', { skip }, async () => {
  const done = mkDiag(kimClient.id, { status: 'completed' })
  const wip = mkDiag(kimClient.id, { status: 'in_progress' })
  await kim.c.call('PUT', `/api/diagnoses/${done.id}`, done)
  await kim.c.call('PUT', `/api/diagnoses/${wip.id}`, wip)
  const clients = (await clientUser.c.call('GET', '/api/clients')).json
  assert.deepEqual(clients.map((c) => c.id), [kimClient.id])
  const diags = (await clientUser.c.call('GET', '/api/diagnoses')).json
  assert.ok(diags.some((d) => d.id === done.id))
  assert.equal(diags.some((d) => d.id === wip.id), false)
  assert.ok(diags.every((d) => d.clientId === kimClient.id && d.status === 'completed'))
  // 쓰기·관리는 모두 403
  assert.equal((await clientUser.c.call('PUT', `/api/clients/${kimClient.id}`, { ...kimClient, name: '변경' })).status, 403)
  assert.equal((await clientUser.c.call('PUT', `/api/diagnoses/${done.id}`, { ...done, status: 'in_progress' })).status, 403)
  assert.equal((await clientUser.c.call('DELETE', `/api/diagnoses/${done.id}`)).status, 403)
  assert.equal((await clientUser.c.call('DELETE', `/api/clients/${kimClient.id}`)).status, 403)
  assert.equal((await clientUser.c.call('POST', '/api/clients/import', { clients: [{ name: 'x', profile }] })).status, 403)
  assert.equal((await clientUser.c.call('PUT', '/api/checklists/labor', { data: [riskItem()] })).status, 403)
  // 체크리스트 조회는 가능(보고서를 그리려면 필요)
  assert.equal((await clientUser.c.call('GET', '/api/checklists')).status, 200)
})

// ---------------- 진단 모드 ----------------
test('진단 모드: 기본은 full, quick 저장, 잘못된 값은 400', { skip }, async () => {
  const d = mkDiag(kimClient.id)
  assert.equal((await kim.c.call('PUT', `/api/diagnoses/${d.id}`, d)).json.mode, 'full')
  assert.equal((await kim.c.call('PUT', `/api/diagnoses/${d.id}`, { ...d, mode: 'quick' })).json.mode, 'quick')
  assert.equal((await kim.c.call('GET', '/api/diagnoses')).json.find((x) => x.id === d.id).mode, 'quick')
  assert.equal((await kim.c.call('PUT', `/api/diagnoses/${d.id}`, { ...d, mode: 'lite' })).status, 400)
})

// ---------------- 체크리스트 수정(관리자) ----------------
test('체크리스트: 관리자만 저장·삭제, 모두 조회, 형식 오류는 목록과 함께 거부', { skip }, async () => {
  assert.deepEqual((await kim.c.call('GET', '/api/checklists')).json, { overrides: {} })
  assert.equal((await kim.c.call('PUT', '/api/checklists/labor', { data: [riskItem()] })).status, 403)
  assert.equal((await kim.c.call('DELETE', '/api/checklists/labor')).status, 403)
  const bad = await admin.call('PUT', '/api/checklists/labor', { data: [riskItem({ signal: 'purple', answer_type: 'text' }), riskItem({ id: 'T-001' }), riskItem({ id: 'bad id!' })] })
  assert.equal(bad.status, 400)
  assert.ok(bad.json.errors.length >= 3)
  assert.equal((await admin.call('PUT', '/api/checklists/labor', { data: [] })).status, 400)
  assert.equal((await admin.call('PUT', '/api/checklists/Bad_Domain', { data: [riskItem()] })).status, 400)
  const ok = await admin.call('PUT', '/api/checklists/labor', { data: [riskItem(), riskItem({ id: 'T-002', quick: true })] })
  assert.equal(ok.status, 200)
  const got = (await kim.c.call('GET', '/api/checklists')).json.overrides
  assert.equal(got.labor.data.length, 2)
  assert.equal(got.labor.updatedBy, '관리자')
  assert.equal((await admin.call('PUT', '/api/checklists/labor', { data: [riskItem({ domain: 'accounting' })] })).status, 400) // domain 불일치
  assert.equal((await admin.call('DELETE', '/api/checklists/labor')).status, 200)
  assert.deepEqual((await kim.c.call('GET', '/api/checklists')).json, { overrides: {} })
})

test('체크리스트: 법인 일반관리(상태 점검표) 형식도 저장된다', { skip }, async () => {
  const data = {
    id: 'x', domain: 'corporate-general', title: '점검표', source: 's',
    status_options: [{ code: 'ok' }, { code: 'fix' }, { code: 'bad' }, { code: 'na' }],
    areas: [{ id: '01', name: '영역', key_point: '핵심', items: [{ id: 'GM-01-01', text: '항목', check: '점검', recommendation: '권고', risk_level: 'high' }] }],
  }
  assert.equal((await admin.call('PUT', '/api/checklists/corporate-general', { data })).status, 200)
  data.areas[0].items[0].risk_level = 'extreme'
  assert.equal((await admin.call('PUT', '/api/checklists/corporate-general', { data })).status, 400)
  await admin.call('DELETE', '/api/checklists/corporate-general')
})

// ---------------- 엑셀 일괄 가져오기 ----------------
test('고객사 일괄 가져오기: 새 고객사 추가·내 고객사 수정, 오류가 있으면 전부 취소', { skip }, async () => {
  const mine = mkClient('(주)가져오기수정전')
  await kim.c.call('PUT', `/api/clients/${mine.id}`, mine)
  const ok = await kim.c.call('POST', '/api/clients/import', { clients: [{ id: mine.id, name: '(주)가져오기수정후', profile }, { name: '(주)가져온신규', profile }] })
  assert.deepEqual(ok.json, { created: 1, updated: 1 })
  const list = (await kim.c.call('GET', '/api/clients')).json
  assert.ok(list.some((c) => c.id === mine.id && c.name === '(주)가져오기수정후'))
  assert.ok(list.some((c) => c.name === '(주)가져온신규' && c.ownerId === kim.id))

  // 한 행이라도 오류이면 아무것도 저장되지 않는다
  const before = (await kim.c.call('GET', '/api/clients')).json.length
  const bad = await kim.c.call('POST', '/api/clients/import', { clients: [{ name: '(주)저장되면안됨', profile }, { name: '', profile }, { name: 'x', profile: 'no' }] })
  assert.equal(bad.status, 400)
  assert.deepEqual(bad.json.errors.map((e) => e.row), [2, 3])
  assert.equal((await kim.c.call('GET', '/api/clients')).json.length, before)

  // 남의 고객사 ID 로는 수정할 수 없고, 컨설턴트는 담당자를 지정할 수 없다
  assert.equal((await lee.c.call('POST', '/api/clients/import', { clients: [{ id: kimClient.id, name: '탈취', profile }] })).status, 409)
  const owner = await kim.c.call('POST', '/api/clients/import', { clients: [{ name: 'x', profile, ownerId: lee.id }] })
  assert.equal(owner.status, 400)
  // 관리자는 담당자를 지정할 수 있다
  const adm = await admin.call('POST', '/api/clients/import', { clients: [{ name: '(주)관리자가져옴', profile, ownerId: lee.id }] })
  assert.equal(adm.status, 200)
  assert.ok((await lee.c.call('GET', '/api/clients')).json.some((c) => c.name === '(주)관리자가져옴'))
  // 건수 제한
  assert.equal((await kim.c.call('POST', '/api/clients/import', { clients: [] })).status, 400)
  assert.equal((await kim.c.call('POST', '/api/clients/import', { clients: Array.from({ length: 501 }, () => ({ name: 'x', profile })) })).status, 400)
})

// ---------------- 샘플 데이터 ----------------
test('샘플: 지우기·다시 넣기·계정 만들기(무작위 비밀번호), 샘플 계정의 권한 범위', { skip }, async () => {
  // 계정 만들기
  const acc = await admin.call('POST', '/api/admin/sample/accounts')
  assert.equal(acc.status, 200)
  assert.equal(acc.json.created.length, 2)
  const cons = acc.json.created.find((a) => a.role === 'consultant')
  const cli = acc.json.created.find((a) => a.role === 'client')
  assert.match(cons.password, /^[A-Za-z0-9_-]{12}$/)
  assert.notEqual(cons.password, cli.password)
  assert.equal((await admin.call('POST', '/api/admin/sample/accounts')).json.created.length, 0) // 두 번째는 건너뜀

  // 샘플 컨설턴트: 새봄푸드만 보인다
  const sc = await login(url, cons.username, cons.password)
  const own = (await sc.call('GET', '/api/clients')).json
  assert.deepEqual(own.map((c) => c.name), ['[샘플] 새봄푸드'])
  assert.ok((await sc.call('GET', '/api/diagnoses')).json.length >= 2)
  // 샘플 고객: 한빛정밀의 완료된 진단만
  const scl = await login(url, cli.username, cli.password)
  assert.deepEqual((await scl.call('GET', '/api/clients')).json.map((c) => c.name), ['[샘플] (주)한빛정밀'])
  const cd = (await scl.call('GET', '/api/diagnoses')).json
  assert.ok(cd.length >= 3 && cd.every((d) => d.status === 'completed'))
  assert.deepEqual([...new Set(cd.map((d) => d.mode))].sort(), ['full', 'quick'])

  // 샘플 지우기: 샘플 고객사·진단·계정이 사라지고 실제 데이터는 남는다
  const del = await admin.call('DELETE', '/api/admin/sample')
  assert.deepEqual(del.json, { clientsRemoved: 3, accountsRemoved: 2, accountsDeactivated: 0 })
  const left = (await admin.call('GET', '/api/clients')).json
  assert.equal(left.some((c) => c.isSample), false)
  assert.ok(left.some((c) => c.id === kimClient.id))
  assert.equal((await sc.call('GET', '/api/clients')).status, 401)
  const st = (await admin.call('GET', '/api/admin/sample')).json
  assert.deepEqual({ c: st.clientCount, d: st.diagnosisCount, a: st.accounts.length }, { c: 0, d: 0, a: 0 })
  assert.equal((await admin.call('POST', '/api/admin/sample/accounts')).status, 409) // 샘플 고객사가 없으면 계정을 만들 수 없다

  // 다시 넣기
  const again = await admin.call('POST', '/api/admin/sample')
  assert.deepEqual(again.json, { seeded: true, clients: 3, diagnoses: 9 })
  assert.deepEqual((await admin.call('POST', '/api/admin/sample')).json, { seeded: false, clients: 0, diagnoses: 0 })
})

test('샘플 계정이 실제 고객사를 갖고 있으면 지울 때 삭제 대신 비활성화', { skip }, async () => {
  const acc = await admin.call('POST', '/api/admin/sample/accounts')
  const cons = acc.json.created.find((a) => a.role === 'consultant')
  const sc = await login(url, cons.username, cons.password)
  const real = mkClient('(주)샘플컨설턴트의실제고객')
  assert.equal((await sc.call('PUT', `/api/clients/${real.id}`, real)).status, 200)
  const del = await admin.call('DELETE', '/api/admin/sample')
  assert.equal(del.json.accountsDeactivated, 1)
  assert.ok((await admin.call('GET', '/api/clients')).json.some((c) => c.id === real.id)) // 실제 고객사는 남는다
  assert.equal((await sc.call('GET', '/api/clients')).status, 401)
})

// ---------------- 입력·보안 ----------------
test('입력 검증: ID·도메인·상태·본문 크기·SQL 문자열', { skip }, async () => {
  const cl = mkClient()
  assert.equal((await kim.c.call('PUT', '/api/clients/not-a-uuid', cl)).status, 400)
  assert.equal((await kim.c.call('PUT', `/api/clients/${randomUUID()}`, { ...cl, name: '' })).status, 400)
  assert.equal((await kim.c.call('PUT', `/api/clients/${randomUUID()}`, { ...cl, profile: 'x' })).status, 400)
  assert.equal((await kim.c.call('PUT', `/api/diagnoses/${randomUUID()}`, mkDiag(kimClient.id, { domain: 'Bad Domain!' }))).status, 400)
  assert.equal((await kim.c.call('PUT', `/api/diagnoses/${randomUUID()}`, mkDiag(kimClient.id, { status: 'hacked' }))).status, 400)
  assert.equal((await kim.c.call('PUT', `/api/diagnoses/${randomUUID()}`, mkDiag(kimClient.id, { answers: [] }))).status, 400)
  const evil = mkClient("'); drop table app_users; --")
  assert.equal((await kim.c.call('PUT', `/api/clients/${evil.id}`, evil)).status, 200)
  assert.ok((await dbApi.pool.query('select count(*)::int as n from app_users')).rows[0].n >= 4)
  assert.equal((await kim.c.call('PUT', `/api/clients/${randomUUID()}`, { ...cl, profile: { junk: 'x'.repeat(1_200_000) } })).status, 413)
  assert.equal((await kim.c.call('GET', '/api/unknown')).status, 404)
})

test('Content-Type 이 JSON 이 아니면 415', { skip }, async () => {
  const r = await fetch(url + `/api/clients/${randomUUID()}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain', Cookie: kim.c.cookie }, body: '{}' })
  assert.equal(r.status, 415)
})

test('CSRF: 다른 출처에서 온 상태 변경 요청은 403', { skip }, async () => {
  const cl = mkClient()
  assert.equal((await kim.c.call('PUT', `/api/clients/${cl.id}`, cl, { Origin: 'https://evil.example.com' })).status, 403)
  assert.equal((await kim.c.call('PUT', `/api/clients/${cl.id}`, cl, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  assert.equal((await kim.c.call('PUT', `/api/clients/${cl.id}`, cl, { Origin: `http://${new URL(url).host}` })).status, 200)
})

test('역할 도입 전에 만든 계정은 가장 먼저 만든 계정이 관리자로 올라간다(마이그레이션)', { skip }, async () => {
  const pg = (await import('pg')).default
  const pool = new pg.Pool({ connectionString: DB })
  const sch = `legacy_${Date.now()}`
  await pool.query(`create schema ${sch}`)
  await pool.query(`set search_path to ${sch}`)
  const c = await pool.connect()
  try {
    await c.query(`set search_path to ${sch}`)
    // 예전 버전의 테이블(role 컬럼 없음)을 흉내 낸다
    await c.query(`create table app_users (id uuid primary key default gen_random_uuid(), email text not null unique, password_hash text not null, created_at timestamptz not null default now())`)
    await c.query(`insert into app_users (email, password_hash, created_at) values ('old1@example.com', 'x', now() - interval '2 days'), ('old2@example.com', 'x', now() - interval '1 day')`)
  } finally {
    c.release()
  }
  const legacyPool = new pg.Pool({ connectionString: DB, options: `-c search_path=${sch}` })
  const api = await createDbApi({ pool: legacyPool })
  const { rows } = await legacyPool.query('select username, role from app_users order by created_at')
  assert.deepEqual(rows, [{ username: 'old1@example.com', role: 'admin' }, { username: 'old2@example.com', role: 'consultant' }]) // 이메일로 만든 예전 계정은 이메일이 그대로 아이디가 된다
  assert.equal((await legacyPool.query('select count(*)::int as n from app_clients where is_sample')).rows[0].n, 3) // 관리자가 있으면 샘플도 한 번 들어간다
  await api.close()
  await pool.query(`drop schema ${sch} cascade`)
  await pool.end()
})

test('만료된 세션은 거부된다', { skip }, async () => {
  const u = await mkUser(admin, 'consultant', '만료')
  const c = await login(url, u.username)
  assert.equal((await c.call('GET', '/api/clients')).status, 200)
  await dbApi.pool.query("update app_sessions set expires_at = now() - interval '1 minute' where user_id = $1", [u.id])
  assert.equal((await c.call('GET', '/api/clients')).status, 401)
})

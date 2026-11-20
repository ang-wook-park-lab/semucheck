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
import { createDbApi } from './api.mjs'

const DB = process.env.TEST_DATABASE_URL
const skip = !DB

let dir, dbApi, server, closedServer, closedApi, url, closedUrl

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

before(async () => {
  if (skip) return
  dir = mkdtempSync(path.join(tmpdir(), 'semucheck-api-'))
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'index.html'), '<div id="root"></div>')
  // 가입이 닫힌 서버(첫 계정만 허용)
  dbApi = await createDbApi({ connectionString: DB, allowSignup: false })
  await dbApi.pool.query('truncate app_users cascade')
  server = createApp({ staticDir: dir, api: dbApi })
  url = await listen(server)
  // 가입이 열린 서버(같은 DB)
  closedApi = await createDbApi({ connectionString: DB, allowSignup: true })
  closedServer = createApp({ staticDir: dir, api: closedApi })
  closedUrl = await listen(closedServer)
})
after(async () => {
  if (skip) return
  server.close()
  closedServer.close()
  await dbApi.close()
  await closedApi.close()
  rmSync(dir, { recursive: true, force: true })
})

test('DB 없이 기동하면 /api/health 는 db:false', { skip: false }, async () => {
  const app = createApp({ staticDir: (() => { const d = mkdtempSync(path.join(tmpdir(), 'semucheck-nodb-')); writeFileSync(path.join(d, 'index.html'), 'x'); return d })() })
  const u = await listen(app)
  const r = await (await fetch(u + '/api/health')).json()
  assert.deepEqual(r, { ok: true, db: false, signup: false })
  assert.equal((await fetch(u + '/api/clients')).status, 404)
  app.close()
})

test('health: DB 연결됨, 첫 가입 가능', { skip }, async () => {
  const r = await (await fetch(url + '/api/health')).json()
  assert.deepEqual(r, { ok: true, db: true, signup: true })
})

test('인증 없이 데이터 API 는 401', { skip }, async () => {
  const c = client(url)
  for (const [m, p] of [['GET', '/api/clients'], ['GET', '/api/diagnoses'], ['PUT', `/api/clients/${randomUUID()}`], ['DELETE', `/api/diagnoses/${randomUUID()}`]]) {
    const r = await c.call(m, p, m === 'PUT' ? mkClient() : undefined)
    assert.equal(r.status, 401, `${m} ${p}`)
  }
  assert.deepEqual((await c.call('GET', '/api/auth/me')).json, { user: null })
})

test('가입 입력 검증', { skip }, async () => {
  const c = client(url)
  assert.equal((await c.call('POST', '/api/auth/signup', { email: 'not-an-email', password: 'password123' })).status, 400)
  const short = await c.call('POST', '/api/auth/signup', { email: 'a@example.com', password: 'short' })
  assert.equal(short.status, 400)
  assert.match(short.json.error, /8자/)
  assert.equal((await c.call('POST', '/api/auth/signup', { email: 'a@example.com', password: 'x'.repeat(201) })).status, 400)
})

test('첫 계정은 가입되고, 이후 가입은 ALLOW_SIGNUP 없이는 403', { skip }, async () => {
  const a = client(url)
  const r = await a.call('POST', '/api/auth/signup', { email: 'Owner@Example.com', password: 'password123' })
  assert.equal(r.status, 201)
  assert.equal(r.json.user.email, 'owner@example.com') // 소문자로 정규화
  const cookie = r.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  assert.deepEqual((await fetch(url + '/api/health').then((x) => x.json())).signup, false)
  const second = await client(url).call('POST', '/api/auth/signup', { email: 'second@example.com', password: 'password123' })
  assert.equal(second.status, 403)
  // 가입이 열린 서버에서는 가능하고, 같은 이메일은 409
  const open = client(closedUrl)
  assert.equal((await open.call('POST', '/api/auth/signup', { email: 'second@example.com', password: 'password123' })).status, 201)
  assert.equal((await client(closedUrl).call('POST', '/api/auth/signup', { email: 'SECOND@example.com', password: 'password123' })).status, 409)
})

test('비밀번호는 평문이 아니라 scrypt 해시로 저장된다', { skip }, async () => {
  const { rows } = await dbApi.pool.query("select password_hash from app_users where email = 'owner@example.com'")
  assert.match(rows[0].password_hash, /^scrypt\$16384\$8\$1\$/)
  assert.doesNotMatch(rows[0].password_hash, /password123/)
  const s = await dbApi.pool.query('select token_hash from app_sessions limit 1')
  assert.match(s.rows[0].token_hash, /^[0-9a-f]{64}$/) // 세션 토큰도 해시로만 저장
})

test('로그인/로그아웃/me', { skip }, async () => {
  const c = client(url)
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'owner@example.com', password: 'wrong-password' })).status, 401)
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'password123' })).status, 401)
  const ok = await c.call('POST', '/api/auth/login', { email: 'OWNER@example.com', password: 'password123' })
  assert.equal(ok.status, 200)
  assert.equal((await c.call('GET', '/api/auth/me')).json.user.email, 'owner@example.com')
  assert.equal((await c.call('POST', '/api/auth/logout', {})).status, 200)
  assert.deepEqual((await c.call('GET', '/api/auth/me')).json, { user: null })
  assert.equal((await c.call('GET', '/api/clients')).status, 401)
})

test('로그인 실패가 반복되면 429', { skip }, async () => {
  const c = client(url)
  let last = 0
  for (let i = 0; i < 12; i++) last = (await c.call('POST', '/api/auth/login', { email: 'brute@example.com', password: `bad-${i}` })).status
  assert.equal(last, 429)
})

test('고객사·진단 CRUD', { skip }, async () => {
  const c = client(url)
  await c.call('POST', '/api/auth/login', { email: 'owner@example.com', password: 'password123' })
  const cl = mkClient('(주)CRUD')
  const put = await c.call('PUT', `/api/clients/${cl.id}`, cl)
  assert.equal(put.status, 200)
  assert.equal(put.json.name, '(주)CRUD')
  assert.deepEqual(put.json.profile, profile)
  // 수정(upsert)
  assert.equal((await c.call('PUT', `/api/clients/${cl.id}`, { ...cl, name: '(주)수정' })).json.name, '(주)수정')
  const list = (await c.call('GET', '/api/clients')).json
  assert.equal(list.filter((x) => x.id === cl.id).length, 1)

  const d = mkDiag(cl.id)
  const dp = await c.call('PUT', `/api/diagnoses/${d.id}`, d)
  assert.equal(dp.status, 200)
  assert.deepEqual(dp.json.answers, { 'LAB-001': '예' })
  assert.equal(dp.json.clientId, cl.id)
  const upd = await c.call('PUT', `/api/diagnoses/${d.id}`, { ...d, answers: { 'LAB-001': '아니오', 'LAB-002': 5 }, notes: { 'LAB-001': '메모' }, status: 'completed', updatedAt: new Date().toISOString() })
  assert.equal(upd.json.status, 'completed')
  assert.deepEqual(upd.json.answers, { 'LAB-001': '아니오', 'LAB-002': 5 }) // 숫자 응답 타입 유지
  assert.deepEqual(upd.json.notes, { 'LAB-001': '메모' })
  const diags = (await c.call('GET', '/api/diagnoses')).json
  assert.equal(diags.filter((x) => x.id === d.id).length, 1)

  // 고객사를 지우면 진단도 함께 삭제
  assert.equal((await c.call('DELETE', `/api/clients/${cl.id}`)).status, 200)
  assert.equal((await c.call('GET', '/api/diagnoses')).json.filter((x) => x.id === d.id).length, 0)
})

test('계정 간 데이터 분리: 남의 데이터는 보이지 않고 덮어쓸 수도 없다', { skip }, async () => {
  const a = client(url)
  await a.call('POST', '/api/auth/login', { email: 'owner@example.com', password: 'password123' })
  const b = client(closedUrl)
  await b.call('POST', '/api/auth/login', { email: 'second@example.com', password: 'password123' })

  const cl = mkClient('(주)A의 고객')
  await a.call('PUT', `/api/clients/${cl.id}`, cl)
  const d = mkDiag(cl.id)
  await a.call('PUT', `/api/diagnoses/${d.id}`, d)

  // B 는 A 의 데이터를 목록에서 볼 수 없다
  assert.equal((await b.call('GET', '/api/clients')).json.some((x) => x.id === cl.id), false)
  assert.equal((await b.call('GET', '/api/diagnoses')).json.some((x) => x.id === d.id), false)
  // B 가 같은 ID 로 덮어쓰기 시도 → 거부
  assert.equal((await b.call('PUT', `/api/clients/${cl.id}`, { ...cl, name: '탈취' })).status, 409)
  assert.equal((await b.call('PUT', `/api/diagnoses/${d.id}`, { ...d, clientId: cl.id, status: 'completed' })).status, 404)
  // B 가 A 의 고객사에 진단을 붙이려는 시도 → 거부
  assert.equal((await b.call('PUT', `/api/diagnoses/${randomUUID()}`, mkDiag(cl.id))).status, 404)
  // B 의 삭제 요청은 A 의 데이터에 영향이 없다
  await b.call('DELETE', `/api/clients/${cl.id}`)
  await b.call('DELETE', `/api/diagnoses/${d.id}`)
  assert.equal((await a.call('GET', '/api/clients')).json.some((x) => x.id === cl.id && x.name === '(주)A의 고객'), true)
  assert.equal((await a.call('GET', '/api/diagnoses')).json.some((x) => x.id === d.id), true)
})

test('입력 검증: ID·도메인·상태·본문 크기', { skip }, async () => {
  const c = client(url)
  await c.call('POST', '/api/auth/login', { email: 'owner@example.com', password: 'password123' })
  const cl = mkClient()
  assert.equal((await c.call('PUT', '/api/clients/not-a-uuid', cl)).status, 400)
  assert.equal((await c.call('PUT', `/api/clients/${randomUUID()}`, { ...cl, name: '' })).status, 400)
  assert.equal((await c.call('PUT', `/api/clients/${randomUUID()}`, { ...cl, profile: 'x' })).status, 400)
  await c.call('PUT', `/api/clients/${cl.id}`, cl)
  assert.equal((await c.call('PUT', `/api/diagnoses/${randomUUID()}`, mkDiag(cl.id, { domain: 'Bad Domain!' }))).status, 400)
  assert.equal((await c.call('PUT', `/api/diagnoses/${randomUUID()}`, mkDiag(cl.id, { status: 'hacked' }))).status, 400)
  assert.equal((await c.call('PUT', `/api/diagnoses/${randomUUID()}`, mkDiag(cl.id, { answers: [] }))).status, 400)
  // SQL 인젝션 시도 문자열은 값으로만 저장된다
  const evil = mkClient("'); drop table app_users; --")
  assert.equal((await c.call('PUT', `/api/clients/${evil.id}`, evil)).status, 200)
  assert.equal((await dbApi.pool.query('select count(*)::int as n from app_users')).rows[0].n >= 2, true)
  // 너무 큰 본문
  const big = await c.call('PUT', `/api/clients/${randomUUID()}`, { ...cl, profile: { junk: 'x'.repeat(1_200_000) } })
  assert.equal(big.status, 413)
  // 알 수 없는 API
  assert.equal((await c.call('GET', '/api/unknown')).status, 404)
})

test('Content-Type 이 JSON 이 아니면 415', { skip }, async () => {
  const c = client(url)
  await c.call('POST', '/api/auth/login', { email: 'owner@example.com', password: 'password123' })
  const r = await fetch(url + `/api/clients/${randomUUID()}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain', Cookie: c.cookie }, body: '{}' })
  assert.equal(r.status, 415)
})

test('CSRF: 다른 출처에서 온 상태 변경 요청은 403', { skip }, async () => {
  const c = client(url)
  await c.call('POST', '/api/auth/login', { email: 'owner@example.com', password: 'password123' })
  const cl = mkClient()
  const evil = await c.call('PUT', `/api/clients/${cl.id}`, cl, { Origin: 'https://evil.example.com' })
  assert.equal(evil.status, 403)
  const crossSite = await c.call('PUT', `/api/clients/${cl.id}`, cl, { 'Sec-Fetch-Site': 'cross-site' })
  assert.equal(crossSite.status, 403)
  const host = new URL(url).host
  assert.equal((await c.call('PUT', `/api/clients/${cl.id}`, cl, { Origin: `http://${host}` })).status, 200)
})

test('사이트 비밀번호(Basic)와 API 쿠키 로그인이 함께 동작', { skip }, async () => {
  const guarded = createApp({ staticDir: dir, api: dbApi, user: 'consultant', password: 'site-pass-1' })
  const u = await listen(guarded)
  const noBasic = await fetch(u + '/api/auth/me')
  assert.equal(noBasic.status, 401)
  assert.match(noBasic.headers.get('www-authenticate') ?? '', /Basic/)
  const basic = 'Basic ' + Buffer.from('consultant:site-pass-1').toString('base64')
  const r = await fetch(u + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: basic }, body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }) })
  assert.equal(r.status, 200)
  guarded.close()
})

test('만료된 세션은 거부된다', { skip }, async () => {
  const c = client(url)
  await c.call('POST', '/api/auth/login', { email: 'owner@example.com', password: 'password123' })
  assert.equal((await c.call('GET', '/api/clients')).status, 200)
  await dbApi.pool.query("update app_sessions set expires_at = now() - interval '1 minute'")
  assert.equal((await c.call('GET', '/api/clients')).status, 401)
})

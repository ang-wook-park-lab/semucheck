import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from './server.mjs'

let dir, open, locked, openUrl, lockedUrl
const listen = (app) => new Promise((r) => app.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${app.address().port}`)))

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'semucheck-static-'))
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>세무체크</title><div id="root"></div>')
  writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log("hi")'.repeat(100))
  writeFileSync(path.join(dir, 'secret.txt'), 'root file')
  open = createApp({ staticDir: dir })
  locked = createApp({ staticDir: dir, supabaseUrl: 'https://abc.supabase.co' })
  openUrl = await listen(open)
  lockedUrl = await listen(locked)
})
after(() => {
  open.close()
  locked.close()
  rmSync(dir, { recursive: true, force: true })
})

test('healthz는 200', async () => {
  assert.equal((await fetch(`${openUrl}/healthz`)).status, 200)
  assert.equal((await fetch(`${lockedUrl}/healthz`)).status, 200)
})

test('앱 라우트는 index.html로 대체(SPA)', async () => {
  for (const p of ['/', '/clients', '/report/abc-123', '/diagnosis/x/y']) {
    const r = await fetch(openUrl + p)
    assert.equal(r.status, 200, p)
    assert.match(await r.text(), /id="root"/)
    assert.equal(r.headers.get('cache-control'), 'no-cache')
  }
})

test('없는 정적 파일은 404, assets는 장기 캐시', async () => {
  assert.equal((await fetch(`${openUrl}/assets/missing.js`)).status, 404)
  const r = await fetch(`${openUrl}/assets/app-abc123.js`, { headers: { 'accept-encoding': 'identity' } })
  assert.equal(r.status, 200)
  assert.match(r.headers.get('cache-control'), /immutable/)
  assert.match(r.headers.get('content-type'), /javascript/)
})

test('경로 이탈(../)은 허용하지 않는다', async () => {
  for (const p of ['/..%2f..%2fetc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..%2f..%2f..%2fetc%2fpasswd']) {
    const r = await fetch(openUrl + p)
    assert.ok([200, 403, 404].includes(r.status), `${p} → ${r.status}`)
    const body = await r.text()
    assert.doesNotMatch(body, /root:/, p)
  }
  const raw = await new Promise((resolve) => {
    import('node:net').then(({ default: net }) => {
      const s = net.connect(open.address().port, '127.0.0.1', () => s.write('GET /../../etc/passwd HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'))
      let buf = ''
      s.on('data', (d) => (buf += d))
      s.on('end', () => resolve(buf))
    })
  })
  assert.doesNotMatch(raw, /root:x/)
})

test('gzip 압축과 보안 헤더', async () => {
  const r = await fetch(`${openUrl}/assets/app-abc123.js`, { headers: { 'accept-encoding': 'gzip' } })
  assert.equal(r.headers.get('content-encoding'), 'gzip')
  // fetch(undici)가 gzip을 자동으로 풀어 주므로 본문은 원문이어야 한다
  assert.match(await r.text(), /console\.log/)
  const h = (await fetch(openUrl)).headers
  assert.match(h.get('content-security-policy'), /script-src 'self'/)
  assert.match(h.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal(h.get('x-content-type-options'), 'nosniff')
  assert.equal(h.get('x-powered-by'), null)
})

test('CSP 연결 허용은 설정한 Supabase 주소만 추가한다', async () => {
  const csp = (await fetch(lockedUrl + '/healthz')).headers.get('content-security-policy')
  assert.match(csp, /connect-src 'self' https:\/\/abc\.supabase\.co wss:\/\/abc\.supabase\.co/)
  const noSupa = (await fetch(openUrl)).headers.get('content-security-policy')
  assert.match(noSupa, /connect-src 'self'(;|$)/)
})

test('POST 등 허용하지 않는 메서드는 405, HEAD는 본문 없음', async () => {
  assert.equal((await fetch(openUrl, { method: 'POST' })).status, 405)
  const h = await fetch(openUrl, { method: 'HEAD' })
  assert.equal(h.status, 200)
  assert.equal(await h.text(), '')
})

test('접속 전 브라우저 로그인 팝업(HTTP Basic)은 없다 — SITE_PASSWORD 가 남아 있어도 무시한다', async () => {
  const saved = [process.env.SITE_PASSWORD, process.env.SITE_USER]
  process.env.SITE_PASSWORD = 'left-over'
  process.env.SITE_USER = 'test1'
  const app = createApp({ staticDir: dir })
  for (const [i, v] of saved.entries()) {
    const k = ['SITE_PASSWORD', 'SITE_USER'][i]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  const url = await listen(app)
  for (const p of ['/', '/assets/app-abc123.js', '/clients']) {
    const r = await fetch(url + p)
    assert.equal(r.status, 200, p)
    assert.equal(r.headers.get('www-authenticate'), null, p)
  }
  app.close()
})

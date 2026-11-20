// 세무체크 정적 웹 서버 (의존성 없음). Railway·Render·Fly 등 Docker/Node 호스트에서 그대로 실행한다.
//  - Vite 빌드 결과(dist)를 서빙하고 SPA 라우트(/clients, /report/... 등)는 index.html로 보낸다.
//  - 접속 전 브라우저 아이디/비밀번호 팝업(HTTP Basic)은 쓰지 않는다. 로그인은 앱 화면의 아이디·비밀번호 하나뿐이다.
//  - /healthz 는 200 (호스팅 헬스체크용).
//  - DATABASE_URL 이 있으면 api.mjs 의 Postgres API(/api/*)를 함께 제공한다. 없으면 /api/health 가 db:false 만 답한다.
import http from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map'])

function findStaticDir(explicit) {
  const candidates = [explicit, path.join(HERE, 'dist'), path.join(HERE, '..', 'web', 'dist')].filter(Boolean)
  const dir = candidates.find((d) => existsSync(path.join(d, 'index.html')))
  if (!dir) throw new Error(`정적 파일(index.html)을 찾지 못했습니다: ${candidates.join(', ')}`)
  return path.resolve(dir)
}

/** 런타임 환경변수로 CSP 연결 허용 대상을 만든다(Supabase를 쓸 때만 외부 주소 추가). */
function buildCsp(supabaseUrl) {
  const connect = ["'self'"]
  if (supabaseUrl) {
    try {
      const u = new URL(supabaseUrl)
      connect.push(`https://${u.host}`, `wss://${u.host}`)
    } catch {
      /* 잘못된 URL이면 외부 연결을 허용하지 않는다 */
    }
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // 진행률 막대 등 React 인라인 style 속성 사용
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

export function createApp(config = {}) {
  const root = findStaticDir(config.staticDir ?? process.env.STATIC_DIR)
  const csp = buildCsp(config.supabaseUrl ?? process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)
  const api = config.api ?? null // createDbApi() 결과(선택)

  const gzipCache = new Map() // 파일 경로+수정시각 → gzip 버퍼

  const baseHeaders = (req) => {
    const h = {
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    }
    if (req.headers['x-forwarded-proto'] === 'https') h['Strict-Transport-Security'] = 'max-age=31536000'
    return h
  }

  function send(req, res, status, body, extra = {}) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
    res.writeHead(status, { ...baseHeaders(req), 'Content-Length': buf.length, ...extra })
    res.end(req.method === 'HEAD' ? undefined : buf)
  }

  function serveFile(req, res, file, { cache }) {
    const ext = path.extname(file).toLowerCase()
    const type = MIME[ext] ?? 'application/octet-stream'
    const stat = statSync(file)
    const headers = { 'Content-Type': type, 'Cache-Control': cache, Vary: 'Accept-Encoding' }
    let body = readFileSync(file)
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      const key = `${file}:${stat.mtimeMs}`
      let gz = gzipCache.get(key)
      if (!gz) {
        gz = gzipSync(body)
        gzipCache.set(key, gz)
      }
      body = gz
      headers['Content-Encoding'] = 'gzip'
    }
    send(req, res, 200, body, headers)
  }

  return http.createServer(async (req, res) => {
    try {
      let pathname
      try {
        pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
      } catch {
        return send(req, res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' })
      }
      if (pathname.includes('\0')) return send(req, res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' })

      if (pathname === '/healthz') return send(req, res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })

      if (pathname === '/api' || pathname.startsWith('/api/')) {
        if (api) return await api.handle(req, res, { pathname, headers: baseHeaders(req) })
        const body = pathname === '/api/health' ? { ok: true, db: false } : { error: '데이터베이스가 연결되지 않았습니다.' }
        return send(req, res, pathname === '/api/health' ? 200 : 404, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })
      }

      const target = path.resolve(root, '.' + path.posix.normalize('/' + pathname))
      if (target !== root && !target.startsWith(root + path.sep)) return send(req, res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' })

      let isFile = false
      try {
        isFile = statSync(target).isFile()
      } catch {
        /* 없는 경로 */
      }
      if (isFile) {
        const immutable = pathname.startsWith('/assets/')
        return serveFile(req, res, target, { cache: immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
      }
      // 확장자가 있는 없는 파일은 404, 그 외(앱 라우트)는 index.html (SPA)
      if (path.extname(pathname)) return send(req, res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' })
      return serveFile(req, res, path.join(root, 'index.html'), { cache: 'no-cache' })
    } catch (err) {
      console.error('요청 처리 오류', err)
      if (!res.headersSent) send(req, res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain; charset=utf-8' })
      else res.end()
    }
  })
}

// 직접 실행했을 때만 서버를 시작한다(테스트에서는 createApp만 가져다 쓴다).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000)
  let api = null
  if (process.env.DATABASE_URL) {
    // DB 가 아직 준비되지 않았을 수 있어 몇 번 재시도한다. 끝내 실패하면 종료한다(데모 모드로 조용히 떨어지면 데이터가 브라우저에만 저장되므로).
    const { createDbApi } = await import('./api.mjs')
    for (let attempt = 1; ; attempt++) {
      try {
        api = await createDbApi({
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.DATABASE_SSL === 'true',
          adminUsername: process.env.ADMIN_USERNAME,
          adminPassword: process.env.ADMIN_PASSWORD,
          resetAdmin: process.env.ADMIN_RESET === 'true',
        })
        break
      } catch (err) {
        console.error(`DB 연결 실패(${attempt}/5): ${err.message}`)
        if (attempt >= 5) process.exit(1)
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
    console.log('DB 연결 완료, 테이블 확인 완료')
  }
  const app = createApp({ api })
  app.listen(port, '0.0.0.0', () => {
    console.log(`세무체크 서버 시작: 포트 ${port}, DB ${api ? '연결됨' : '없음(데모 모드)'}`)
  })
  const stop = () => app.close(() => (api ? api.close().finally(() => process.exit(0)) : process.exit(0)))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

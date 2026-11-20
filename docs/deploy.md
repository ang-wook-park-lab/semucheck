# 배포 안내 (Railway 기준)

저장소 루트의 `Dockerfile`, `railway.json`, `deploy/server.mjs`가 배포 구성입니다. Railway에서 이 저장소를 연결하면 바로 빌드·실행됩니다. Render, Fly.io 등 Docker를 받는 호스트에서도 같은 구성으로 동작합니다.

## 한눈에 보기
| 항목 | 내용 |
|---|---|
| 빌드 | 저장소 **루트**의 `Dockerfile` (Vite 빌드 → 정적 서버 이미지) |
| 실행 | `node server.mjs` (의존성 없음, `PORT` 환경변수 사용) |
| 헬스체크 | `/healthz` (인증 없이 200) |
| 주의 | **Root Directory를 `web`으로 지정하지 마세요.** `web/`이 `../checklists` 데이터를 읽기 때문에 빌드가 깨집니다. |

## Railway에서 배포하기
1. https://railway.com 에서 **New Project → Deploy from GitHub repo**를 고르고 `ang-wook-park-lab/semucheck`을 선택합니다. 저장소가 목록에 없으면 Railway의 GitHub 앱에 이 저장소 접근 권한을 줘야 합니다(조직 저장소는 조직 소유자 승인이 필요할 수 있습니다).
2. 서비스가 만들어지면 `railway.json`에 따라 Dockerfile로 빌드합니다. 별도 빌드·시작 명령을 넣을 필요가 없습니다.
3. 서비스의 **Variables**에 아래 값을 넣습니다.

   | 변수 | 필수 | 설명 |
   |---|---|---|
   | `SITE_PASSWORD` | **권장(사실상 필수)** | 설정하면 사이트 전체가 비밀번호로 보호됩니다(아래 보안 참고). |
   | `SITE_USER` | 선택 | 보호용 아이디. 기본값 `consultant` |
   | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | 선택 | 실제 로그인·서버 저장을 쓸 때. **빌드 시점에 번들에 들어가므로 바꾸면 다시 배포**해야 합니다. |

4. **Settings → Networking → Generate Domain**으로 주소를 만들고 접속합니다. 브라우저가 아이디/비밀번호(`SITE_USER`/`SITE_PASSWORD`)를 물으면 입력하세요. 그다음 앱 로그인 화면이 나옵니다.
5. 필요하면 같은 화면에서 Custom Domain을 연결합니다.

## 로컬에서 확인
```bash
# Docker가 있을 때 (저장소 루트에서)
docker build -t semucheck .
docker run --rm -p 3000:3000 -e SITE_PASSWORD='바꿀비밀번호' semucheck   # http://localhost:3000

# Docker 없이
cd web && npm install && npm run build && npm run serve
```

## 두 단계로 보호됩니다
| 단계 | 무엇을 막나 | 설정 |
|---|---|---|
| 1. 사이트 비밀번호(HTTP Basic) | 주소를 아는 사람이 화면과 JS 번들을 내려받는 것 | `SITE_PASSWORD` |
| 2. 앱 로그인(컨설턴트 계정) | 컨설턴트별 고객사·진단 데이터 분리 | Supabase 연결(`VITE_SUPABASE_*`) |

### 왜 1단계가 필요한가
체크리스트 문항·권고·근거 조문은 **브라우저로 내려가는 JS 번들 안에 들어 있습니다.** 앱 로그인은 화면 흐름을 막을 뿐이라, 1단계 없이 공개하면 주소를 아는 누구나 번들에서 전체 내용을 읽을 수 있습니다. 문항은 책을 바탕으로 정리한 내용이므로, 공개 범위는 사용을 허락한 컨설턴트에게만 두세요. 접속 실패가 반복되면(1분에 10회) 잠시 차단됩니다.

### 데모 모드와 실제 운영
- `VITE_SUPABASE_*`를 비워 두면 **데모 모드**입니다. 계정·고객사·진단이 **각자 브라우저의 localStorage에만** 저장됩니다. 기기를 바꾸면 보이지 않고, 브라우저 데이터를 지우면 사라지며, 컨설턴트끼리 공유되지 않습니다. 화면 확인용입니다.
- 실제 운영은 Supabase를 연결하세요: `web/README.md`의 "Supabase 설정"(테이블·행 단위 보안 SQL 포함)을 따른 뒤 Railway 변수에 URL과 anon 키를 넣고 다시 배포합니다. `service_role` 키는 절대 넣지 마세요.

## 서버 환경변수 요약
`PORT`(호스팅이 주입), `SITE_PASSWORD`, `SITE_USER`, `STATIC_DIR`(기본: `./dist` 또는 `../web/dist`), `VITE_SUPABASE_URL`(런타임에는 CSP 허용 주소 계산에만 사용).

## 보안 헤더
서버가 CSP(`script-src 'self'` 등), `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, HTTPS 접속 시 HSTS를 붙입니다. Supabase를 쓰면 CSP의 `connect-src`에 그 주소만 추가됩니다.

## 다른 호스트
- **Render / Fly.io**: 저장소 루트의 Dockerfile을 지정하고 위 환경변수를 넣으면 됩니다(포트는 `PORT`).
- **Vercel**: Root Directory를 `web`으로 두고 "Include source files outside of the Root Directory"를 켜야 합니다(`web/vercel.json`이 SPA 라우팅 처리). 이 경우 서버가 없으므로 사이트 비밀번호(1단계)를 쓸 수 없어 Vercel의 접근 보호 기능을 별도로 써야 합니다.

## 개발자용
- 서버 테스트: `cd web && npm run test:deploy` (정적 파일 서빙, SPA 대체, 경로 이탈 차단, 인증, gzip, 보안 헤더)
- 이미지 빌드 단계는 개발 환경에서 직접 실행해 보지 못했습니다(Docker 데몬 없음). 대신 Dockerfile과 같은 순서·같은 파일 배치로 빌드해 실행한 결과를 검증했습니다.

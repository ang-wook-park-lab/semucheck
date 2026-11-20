# 배포 안내 (Railway + Postgres 기준)

저장소 루트의 `Dockerfile`, `railway.json`, `deploy/`(서버)가 배포 구성입니다. Railway에서 이 저장소를 연결하면 빌드·실행됩니다. Render, Fly.io 등 Docker를 받는 호스트에서도 같은 구성으로 동작합니다.

## 한눈에 보기
| 항목 | 내용 |
|---|---|
| 빌드 | 저장소 **루트**의 `Dockerfile` (Vite 빌드 → 서버 이미지) |
| 실행 | `node server.mjs` (`PORT` 환경변수 사용) |
| 헬스체크 | `/healthz` (인증 없이 200) |
| 저장소 | `DATABASE_URL`이 있으면 **Postgres**, 없으면 데모 모드(브라우저 저장) |
| 주의 | **Root Directory를 `web`으로 지정하지 마세요.** `web/`이 `../checklists` 데이터를 읽기 때문에 빌드가 깨집니다. |

## 서비스 변수 (Railway → semucheck 서비스 → Variables)

| 변수 | 값 | 설명 |
|---|---|---|
| `SITE_PASSWORD` | (직접 정한 비밀번호) | **필수에 가깝습니다.** 설정하면 사이트 전체(JS 번들 포함)가 HTTP Basic 인증으로 보호됩니다. 코드·저장소에는 넣지 말고 이 변수로만 설정하세요. |
| `SITE_USER` | (생략 가능) | 보호용 아이디. **기본값은 `test1`** 이라 따로 넣지 않아도 됩니다. 바꾸고 싶을 때만 설정합니다. |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway Postgres 연결. 값 칸에 그대로 입력하면 같은 프로젝트의 Postgres 서비스 주소가 자동으로 채워집니다. 서비스 이름이 `Postgres`가 아니면 그 이름으로 바꾸세요. |
| `ALLOW_SIGNUP` | `true` (선택) | 첫 계정을 만든 뒤에는 새 계정 가입이 닫힙니다. 동료를 추가하려면 잠시 `true`로 열고, 가입이 끝나면 지우세요. |
| `DATABASE_SSL` | `true` (선택) | 공개 주소(`...proxy.rlwy.net`)로 연결할 때만. 같은 프로젝트의 내부 주소(`postgres.railway.internal`)는 필요 없습니다. |

변수를 저장하면 Railway가 자동으로 다시 배포합니다.

### 접속 순서
1. 주소로 접속 → 브라우저의 **사이트 로그인 창**에 아이디 `test1`(기본값)과 `SITE_PASSWORD`에 설정한 비밀번호를 입력합니다.
2. 앱 로그인 화면이 나옵니다. **처음에는 계정이 없으므로 "가입하기"로 첫 계정**(본인 이메일, 8자 이상 비밀번호)을 만듭니다. 이 계정이 첫 컨설턴트 계정입니다.
3. 이후부터는 그 계정으로 로그인합니다. 고객사와 진단은 Postgres에 저장되어 **다른 기기·브라우저에서도 같은 데이터가 보입니다.**
4. 화면 상단에 "데모 모드" 표시가 보이면 `DATABASE_URL`이 연결되지 않은 것입니다. 변수와 배포 로그("DB 연결 완료")를 확인하세요.

## Railway에서 처음 배포하기
1. https://railway.com 에서 **New Project → Deploy from GitHub repo**를 고르고 `ang-wook-park-lab/semucheck`을 선택합니다. 저장소가 목록에 없으면 Railway의 GitHub 앱에 접근 권한을 줘야 합니다.
2. 같은 프로젝트에 **Database → Add PostgreSQL**을 추가합니다.
3. 위 변수를 semucheck 서비스에 입력합니다.
4. **Settings → Networking → Generate Domain**으로 주소를 만들고 접속합니다.

## 두 단계로 보호됩니다
| 단계 | 무엇을 막나 | 설정 |
|---|---|---|
| 1. 사이트 비밀번호(HTTP Basic) | 주소를 아는 사람이 화면과 JS 번들을 내려받는 것 | `SITE_PASSWORD`, `SITE_USER` |
| 2. 앱 로그인(컨설턴트 계정) | 컨설턴트별 고객사·진단 데이터 분리 | `DATABASE_URL` (또는 Supabase) |

### 왜 1단계가 필요한가
체크리스트 문항·권고·근거 조문은 **브라우저로 내려가는 JS 번들 안에 들어 있습니다.** 앱 로그인은 화면 흐름과 데이터 접근만 막을 뿐이라, 1단계 없이 공개하면 주소를 아는 누구나 번들에서 전체 내용을 읽을 수 있습니다. 문항은 책을 바탕으로 정리한 내용이므로 공개 범위는 사용을 허락한 컨설턴트에게만 두세요. 접속 실패가 반복되면(1분에 10회) 잠시 차단됩니다.

> **비밀번호 강도**: 서비스·회사 이름과 숫자로 이뤄진 비밀번호는 추측되기 쉽습니다. 실제 고객 정보를 넣기 전에 길고 무작위인 값으로 바꾸는 것을 권합니다(Railway 변수만 바꾸면 됩니다).

## DB 모드가 하는 일
- 시작할 때 테이블(`app_users`, `app_sessions`, `app_clients`, `app_diagnoses`)을 **자동으로 만듭니다.** 별도 마이그레이션이 필요 없습니다.
- 비밀번호는 `scrypt` 해시로만 저장하고, 로그인 세션은 HttpOnly 쿠키(14일)이며 서버에는 토큰의 해시만 남습니다.
- 모든 데이터는 계정(소유자)별로 분리됩니다. 다른 계정의 ID로 덮어쓰기를 시도해도 거부됩니다.
- 로그인 실패가 15분에 10회를 넘으면 해당 이메일·접속지의 로그인을 잠시 막습니다.
- DB에 연결하지 못하면(5회 재시도 후) 서버가 종료됩니다. 데모 모드로 조용히 떨어지면 데이터가 브라우저에만 저장되기 때문입니다. 배포 로그에서 원인을 확인하세요.
- **백업**: Railway Postgres 서비스의 백업 기능(또는 `pg_dump`)을 켜 두세요. 고객 데이터가 이 DB에만 있습니다.

## 데모 모드와 Supabase
- `DATABASE_URL`도 Supabase 변수도 없으면 **데모 모드**입니다. 계정·고객사·진단이 각자 브라우저에만 저장되므로 화면 확인용입니다.
- Postgres 대신 Supabase를 쓰고 싶다면 `web/README.md`의 "Supabase 설정"을 따르고 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣어 다시 배포하세요(빌드 시점 변수). 둘 다 있으면 Supabase가 우선합니다.

## 로컬에서 확인
```bash
# Docker가 있을 때 (저장소 루트에서)
docker build -t semucheck .
docker run --rm -p 3000:3000 -e SITE_PASSWORD='바꿀비밀번호' semucheck   # http://localhost:3000 (아이디 test1)

# Docker 없이 (DB 없는 데모 모드)
cd web && npm install && npm run build && cd ../deploy && npm install && cd ../web && npm run serve

# DB까지 붙여서
DATABASE_URL=postgresql://사용자:비밀번호@localhost:5432/DB이름 ALLOW_SIGNUP=true npm run serve
```

## 서버 환경변수 요약
`PORT`(호스팅이 주입), `SITE_PASSWORD`, `SITE_USER`(기본 `test1`), `DATABASE_URL`, `DATABASE_SSL`, `ALLOW_SIGNUP`, `STATIC_DIR`(기본: `./dist` 또는 `../web/dist`), `VITE_SUPABASE_URL`(런타임에는 CSP 허용 주소 계산에만 사용).

## 보안 헤더
서버가 CSP(`script-src 'self'` 등), `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, HTTPS 접속 시 HSTS를 붙입니다. 상태를 바꾸는 API 요청은 같은 출처의 요청만 받습니다(CSRF 방어).

## 다른 호스트
- **Render / Fly.io**: 저장소 루트의 Dockerfile을 지정하고 위 환경변수를 넣으면 됩니다(포트는 `PORT`).
- **Vercel**: 서버가 없어 DB 모드와 사이트 비밀번호(1단계)를 쓸 수 없습니다. 쓰려면 Supabase와 Vercel의 접근 보호 기능을 따로 써야 합니다.

## 개발자용
- 서버 테스트: `cd web && npm run test:deploy` (정적 서빙, SPA 대체, 경로 이탈 차단, 인증, gzip, 보안 헤더)
- API 테스트(Postgres 필요, 테스트용 DB만 가리키세요): `TEST_DATABASE_URL=postgresql://... node --test deploy/api.test.mjs` — 인증·계정 분리·CSRF·입력 검증·세션 만료. DB 주소가 없으면 건너뜁니다.
- 이미지 빌드 단계는 개발 환경에서 직접 실행해 보지 못했습니다(Docker 데몬 없음). 대신 Dockerfile과 같은 순서·같은 파일 배치로 빌드해 실행한 결과를 검증했습니다.

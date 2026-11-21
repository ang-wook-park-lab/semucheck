# 세무체크 (semucheck): 컨설팅 진단 프로그램

컨설턴트용 웹 진단 도구입니다. 정책자금, 회계, 노무 분야 전문서적에서 진단 기준을 뽑아 체크리스트로 만들고, 그 체크리스트로 웹 진단 화면과 결과 리포트를 생성합니다.

## 작업 흐름

1. **책 읽기**: 한 권씩, 장(章)별로 읽고 요약 노트를 `knowledge/<분야>/`에 저장
2. **체크리스트**: 요약 노트를 진단 문항(JSON)으로 변환해 `checklists/<분야>/`에 저장
3. **검토**: 컨설턴트가 문항, 판단 기준, 근거 법령을 검토하고 최신 법령에 맞게 수정
4. **화면**: 시제품 화면을 확인한 뒤 `web/`에서 실제 웹사이트 개발
5. **배포**: Railway 등 Docker 호스트에 배포(`docs/deploy.md`). Postgres에 계정(관리자·컨설턴트·고객 역할)과 고객사·진단결과 저장, 가입 없이 관리자가 계정 생성

## 폴더 구조

| 폴더 | 내용 |
|---|---|
| `books/` | 원본 책 파일 (저작권 보호를 위해 git에 올리지 않음) |
| `knowledge/` | 책별·장별 요약 노트 (Markdown) |
| `checklists/` | 분야별 진단 문항 데이터 (JSON) |
| `schema/` | 진단 문항 데이터 형식 정의 |
| `web/` | 웹 프로그램 소스 (실행 방법은 `web/README.md`) |
| `deploy/` | 배포용 서버(`server.mjs` 정적 서빙, `api.mjs` Postgres API·권한, `sample.mjs` 샘플 데이터)와 테스트. 루트의 `Dockerfile`·`railway.json`과 함께 사용 |
| `docs/` | 배포 안내(`deploy.md`), 화면 설계, 진행 기록 |

분야 폴더 이름: `policy-fund`(정책자금), `corporate-general`(법인 일반관리), `accounting`(회계), `labor`(노무), `startup`(창업), `credit`(신용등급)

## 원칙

- 책 문장을 그대로 옮기지 않고, 진단 기준과 판단 논리만 정리합니다.
- 금액, 요율, 기준일은 출간 시점과 다를 수 있으므로 문항마다 근거와 확인일(`verified_at`)을 남깁니다.
- 지식(데이터)과 프로그램(코드)을 분리해, 법령이 바뀌면 데이터만 고칩니다.

## 진행 현황

| 분야 | 학습한 자료 | 지식 노트 | 체크리스트 |
|---|---|---|---|
| 정책자금 | 강민수, 정책자금·인증·R&D 통합 실무서(2026), 1~16부와 부록 A~D | `knowledge/policy-fund/kms-integrated/` (18개 파일) | `checklists/policy-fund/fund-diagnosis.json` (76문항, 초안) |
| 법인 일반관리 | 정책자금 도서 76장 점검표(그림 16부-3) | `knowledge/policy-fund/kms-integrated/16_part16_consulting-practice.md` | `checklists/corporate-general/general-64.json` (8영역 64항목, ○△×— 점검표, 초안) |
| 회계 | 정책자금 도서 정리(가결산·5대 위험 항목·세무 T1~T3) + 회계·세무 실무 일반 | `knowledge/accounting/` (7개 파일) | `checklists/accounting/accounting-diagnosis.json` (74문항, 초안) |
| 신용등급 | 정책자금 도서 15부 기업등급 완전해부(69~73장: 재무 70%·비재무 25%·기술 5%, 재무비율 15개, 5대 위험 항목) | `knowledge/credit/README.md` | `checklists/credit/credit-diagnosis.json` (55문항, 재무비율 자동 분석·등급 준비도·개선 로드맵, 초안) |
| 창업 | 중소기업창업 지원법 시행령 창업 제외 6가지(정책자금 도서 2부 8장) + 조세특례제한법 제6조 창업중소기업 감면 일반 지식 | `knowledge/startup/README.md` | `checklists/startup/startup-diagnosis.json` (34문항, 창업지원법·세법별 창업 인정 판정, 초안) |
| 노무 | HR 실무 지침 5종(취업규칙 개정·신고, 근태·연차, 괴롭힘·성희롱 조사, 징계·해고, HR KPI 보고) | `knowledge/labor/` (6개 파일) | `checklists/labor/labor-diagnosis.json` (89문항, 초안) |

정책자금 도서는 76장과 부록 A~D까지 전권을 정리했습니다. 책 안에서 수치가 서로 다른 곳(연구전담요원 수, 업종별 융자제한 부채비율, 임원퇴직금 한도 배수)은 해당 노트에 `[확인 필요]`로 표시했으니, 체크리스트 문항(FUND-049~076)에 반영했으나 최신 법령·공고로 확인 후 `verified_at`을 채웁니다. 확인 대상 목록은 `checklists/policy-fund/README.md`에 있습니다.

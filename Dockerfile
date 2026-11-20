# 세무체크 웹 배포용 이미지. 저장소 루트를 빌드 컨텍스트로 쓴다.
# (web/ 이 ../checklists 데이터를 읽기 때문에 Root Directory를 web 으로 지정하면 빌드가 깨진다.)

# ---- 1단계: Vite 빌드 ----
FROM node:22-alpine AS build
WORKDIR /repo

COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund

COPY web web
COPY checklists checklists

# Vite 환경변수는 빌드 시점에 번들에 들어간다. 비워 두면 데모 모드(이 브라우저에만 저장)로 빌드된다.
# Railway는 같은 이름의 서비스 변수를 빌드 인자로 넘겨 준다.
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN cd web && npm run build

# ---- 2단계: 실행(정적 서버만 포함, 의존성 없음) ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/web/dist ./dist
COPY deploy/server.mjs ./server.mjs
USER node
EXPOSE 3000
# 호스팅이 PORT 를 주입한다(없으면 3000). SITE_PASSWORD 를 설정하면 사이트 전체가 비밀번호로 보호된다.
CMD ["node", "server.mjs"]

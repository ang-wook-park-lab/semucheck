import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 체크리스트 데이터(../checklists)는 프로그램과 분리된 데이터이므로 저장소 루트의 JSON을 그대로 읽는다.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  test: { environment: 'node' },
})

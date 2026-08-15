import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 라우트 핸들러를 그대로 import해서 테스트하려면 tsconfig의 "@/*" 별칭이
// vitest 쪽에도 있어야 한다 (next만 알고 있는 설정이라 여기서 다시 적는다).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
})

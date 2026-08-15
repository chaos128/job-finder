import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@job-finder/db', '@job-finder/graph', '@job-finder/mailer', '@job-finder/scoring', '@job-finder/sources'],
  // 워크스페이스 패키지의 상대 import가 `.js` 확장자로 `.ts` 소스를 가리킨다
  // (Node ESM 관례). webpack은 이 매핑을 기본으로 모르므로 직접 alias를 준다.
  webpack(config) {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },
}

export default config

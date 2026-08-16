'use client'

import { Button } from '@job-finder/ui'

// 운영용 화면이라 빈 화면보다 원인이 보이는 편이 낫다. 다만 Next는 프로덕션 빌드에서
// 서버 에러의 실제 message를 지우고 일반 문구로 바꾼다 — 이 저장소엔 대시보드도 로그
// 수집기도 없어서, 남는 유일한 단서인 digest를 서버 로그와 대조할 수 있게 함께 보여준다.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-bold text-red-700">대시보드를 불러오지 못했습니다</h1>
      <pre className="mt-4 overflow-x-auto rounded bg-neutral-100 p-4 text-sm">
        {error.message}
        {error.digest && `\ndigest: ${error.digest}`}
      </pre>
      <Button type="button" variant="outline" onClick={reset} className="mt-4">
        다시 시도
      </Button>
    </main>
  )
}

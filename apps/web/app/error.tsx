'use client'

import { Button } from '@job-finder/ui'

// 운영용 화면이라 빈 화면보다 원인이 보이는 편이 낫다.
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-bold text-red-700">대시보드를 불러오지 못했습니다</h1>
      <pre className="mt-4 overflow-x-auto rounded bg-neutral-100 p-4 text-sm">{error.message}</pre>
      <Button type="button" variant="outline" onClick={reset} className="mt-4">
        다시 시도
      </Button>
    </main>
  )
}

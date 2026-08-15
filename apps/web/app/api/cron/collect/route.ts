import { runCollect } from '@job-finder/graph'
import { createWantedSource } from '@job-finder/sources'
import { getStore } from '@/lib/store'
import { requireBearer } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const denied = requireBearer(req, process.env.CRON_SECRET)
  if (denied) return denied

  const report = await runCollect(
    { store: getStore(), source: createWantedSource() },
    'cron',
  )
  // 건별 실패가 있으면 5xx. 대시보드도 알림도 없어서 Vercel cron 로그의 상태
  // 코드가 소유자에게 닿는 유일한 신호다 — 200이면 수집이 멈춰도 성공으로 찍힌다.
  // /api/run의 부분 실패는 207이지만 여기선 안 된다: Vercel은 2xx를 성공으로 센다.
  // 본문은 그대로 유지한다 — 장애 중에도 부분 결과는 봐야 한다.
  return Response.json(report, { status: report.failed.length > 0 ? 500 : 200 })
}

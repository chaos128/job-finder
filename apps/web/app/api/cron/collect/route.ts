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
  return Response.json(report)
}

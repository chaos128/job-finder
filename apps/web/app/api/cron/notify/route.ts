import { runNotify } from '@job-finder/graph'
import { getMailer } from '@/lib/mailer'
import { getStore } from '@/lib/store'
import { requireBearer } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const denied = requireBearer(req, process.env.CRON_SECRET)
  if (denied) return denied

  const report = await runNotify({ store: getStore(), mailer: getMailer() }, 'cron')
  return Response.json(report)
}

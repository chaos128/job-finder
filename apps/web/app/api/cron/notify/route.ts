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
  // collect 쪽과 같은 이유로 5xx — 발송 실패는 sent:0으로 idle과 구분되지 않는다.
  return Response.json(report, { status: report.failed.length > 0 ? 500 : 200 })
}

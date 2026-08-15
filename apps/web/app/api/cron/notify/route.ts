import { runNotify, NOTIFY_SKIP_MISCONFIGURED } from '@job-finder/graph'
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
  // 설정 누락 skip도 함께 올린다. 이쪽은 아무것도 실패하지 않아 failed가 비지만,
  // 고쳐주기 전까지 매일 조용히 아무 일도 안 하는 상태라 idle보다 위험하다.
  // 'no candidates above threshold'는 정상 idle이므로 200을 유지한다.
  const broken = report.failed.length > 0 || report.skipped === NOTIFY_SKIP_MISCONFIGURED
  return Response.json(report, { status: broken ? 500 : 200 })
}

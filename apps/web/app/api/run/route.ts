import { runCollect, runNotify } from '@job-finder/graph'
import { createWantedSource } from '@job-finder/sources'
import { getMailer } from '@/lib/mailer'
import { getStore } from '@/lib/store'
import { requireBearer } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 수동 실행. ?stage=collect|notify|all (기본 all)
 * cron을 기다리지 않고 지금 돌려보기 위한 것 — 디버깅과 초기 확인에 쓴다.
 */
export async function POST(req: Request) {
  const denied = requireBearer(req, process.env.CRON_SECRET)
  if (denied) return denied

  const stage = new URL(req.url).searchParams.get('stage') ?? 'all'
  if (!['collect', 'notify', 'all'].includes(stage)) {
    return Response.json({ error: `unknown stage: ${stage}` }, { status: 400 })
  }

  const store = getStore()
  const result: Record<string, unknown> = {}

  if (stage === 'collect' || stage === 'all') {
    result.collect = await runCollect({ store, source: createWantedSource() }, 'manual')
  }
  if (stage === 'notify' || stage === 'all') {
    result.notify = await runNotify({ store, mailer: getMailer() }, 'manual')
  }

  return Response.json(result)
}

import { runCollect, runNotify } from '@job-finder/graph'
import { createWantedSource } from '@job-finder/sources'
import { getMailer } from '@/lib/mailer'
import { getStore } from '@/lib/store'
import { requireBearer } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 한 단계를 실행하고 실패를 흡수한다 — stage=all에서 한쪽이 던져도 다른 쪽
 * 결과가 지워지지 않게 하기 위함. 성공 시 리포트를 그대로, 실패 시
 * { error: message }를 돌려주고 호출부가 ok로 성공 여부를 판단한다.
 */
async function runPhase<T>(fn: () => Promise<T>): Promise<{ ok: boolean; value: T | { error: string } }> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, value: { error: errorMessage(err) } }
  }
}

/**
 * 수동 실행. ?stage=collect|notify|all (기본 all)
 * cron을 기다리지 않고 지금 돌려보기 위한 것 — 디버깅과 초기 확인에 쓴다.
 * 이 라우트는 사람이 직접 두드리는 용도라 실패를 삼키지 않는다 — cron
 * 라우트와 달리 원인 메시지를 그대로 응답 본문에 담아 돌려준다.
 */
export async function POST(req: Request) {
  const denied = requireBearer(req, process.env.CRON_SECRET)
  if (denied) return denied

  const stage = new URL(req.url).searchParams.get('stage') ?? 'all'
  if (!['collect', 'notify', 'all'].includes(stage)) {
    return Response.json({ error: `unknown stage: ${stage}` }, { status: 400 })
  }

  let store: ReturnType<typeof getStore>
  try {
    store = getStore()
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 500 })
  }

  const result: Record<string, unknown> = {}
  const outcomes: boolean[] = []

  if (stage === 'collect' || stage === 'all') {
    const { ok, value } = await runPhase(() => runCollect({ store, source: createWantedSource() }, 'manual'))
    result.collect = value
    outcomes.push(ok)
  }
  if (stage === 'notify' || stage === 'all') {
    const { ok, value } = await runPhase(() => runNotify({ store, mailer: getMailer() }, 'manual'))
    result.notify = value
    outcomes.push(ok)
  }

  // 전부 성공 -> 200, 전부 실패 -> 500, 섞이면 (stage=all에서 한쪽만 실패)
  // 둘 다 아니므로 207 — 성공한 쪽을 200으로도, 실패한 쪽을 500으로도 감출 수 없다.
  const status = outcomes.every(Boolean) ? 200 : outcomes.some(Boolean) ? 207 : 500

  return Response.json(result, { status })
}

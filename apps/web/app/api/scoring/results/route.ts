import { RUBRIC_VERSION, parseScoreItem } from '@job-finder/scoring'
import { getStore } from '@/lib/store'
import { requireBearer } from '@/lib/guard'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const denied = requireBearer(req, process.env.SCORING_TOKEN)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body)) {
    return Response.json({ error: 'body must be an array of score items' }, { status: 400 })
  }

  const store = getStore()
  const rejected: Array<{ jobId: string | null; reason: string }> = []
  let accepted = 0

  // 항목 단위로 검증한다 — 배열 전체를 거부하면 유효한 나머지를 버릴 뿐 아니라
  // 어느 건의 attempts도 오르지 않아 같은 배치가 큐 앞을 영원히 막는다.
  for (const raw of body) {
    const parsed = parseScoreItem(raw)
    if (!parsed.ok) {
      rejected.push({ jobId: parsed.jobId, reason: parsed.reason })
      // jobId를 못 읽으면 attempts를 올릴 대상이 없다 — 응답으로만 알린다.
      if (parsed.jobId) await store.recordScoreFailure(parsed.jobId, parsed.reason).catch(() => {})
      continue
    }
    const item = parsed.item
    try {
      await store.saveScore({
        jobId: item.jobId,
        total: item.total,
        breakdown: item.breakdown,
        reasoning: item.reasoning,
        scorer: 'routine',
        rubricVersion: RUBRIC_VERSION,
      })
      accepted++
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      rejected.push({ jobId: item.jobId, reason })
      await store.recordScoreFailure(item.jobId, reason).catch(() => {})
    }
  }

  return Response.json({ accepted, rejected })
}

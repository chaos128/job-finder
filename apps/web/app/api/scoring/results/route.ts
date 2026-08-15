import { RUBRIC_VERSION, scoreSubmissionSchema } from '@job-finder/scoring'
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

  const parsed = scoreSubmissionSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'schema validation failed', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const store = getStore()
  const rejected: Array<{ jobId: string; reason: string }> = []
  let accepted = 0

  for (const item of parsed.data) {
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

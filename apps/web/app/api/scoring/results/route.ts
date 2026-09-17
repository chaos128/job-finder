import { RUBRIC_VERSION, parseScoreItem } from '@job-finder/scoring'
import { getStore } from '@/lib/store'
import { requireBearer } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 이 점수 이하로 채점된 공고는 저장 직후 자동으로 제외(hidden) 처리한다.
 * 목록 맨 뒤로 내려가 회색으로 표시될 뿐 사라지지는 않으므로, 아니다 싶으면
 * 카드의 되돌리기 버튼으로 다시 올릴 수 있다.
 *
 * 올리기만 하고 내리지는 않는다 — 51점 이상이라고 제외를 풀면 손으로 제외해 둔
 * 공고가 재채점 때 되살아난다. 자동화가 사람의 결정을 덮어써서는 안 된다.
 */
const AUTO_HIDE_MAX_SCORE = 50

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
        summary: item.summary,
        scorer: 'routine',
        rubricVersion: RUBRIC_VERSION,
      })
      accepted++

      // 점수 저장의 후속 처리다. saveScore의 try 안에 두면 이 호출이 실패했을 때
      // 아래 catch가 recordScoreFailure를 불러 **방금 저장된 멀쩡한 점수를
      // status='failed'로 덮어쓴다.** 점수는 이미 저장됐으므로 조용히 삼킨다.
      if (item.total <= AUTO_HIDE_MAX_SCORE) {
        await store.setJobHidden(item.jobId, true).catch(() => {})
      }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      rejected.push({ jobId: item.jobId, reason })
      await store.recordScoreFailure(item.jobId, reason).catch(() => {})
    }
  }

  return Response.json({ accepted, rejected })
}

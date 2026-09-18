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

/**
 * role이 이 점수 이하면 총점과 무관하게 제외한다.
 *
 * 왜 총점만으로는 부족한가: 다섯 축이 20점씩 균등해서, 회사 신호가 좋으면 역할이
 * 안 맞아도 총점이 떠받쳐진다. 실측(백엔드 우선 테크리드 공고 한 건)에서 role 12 ·
 * conditions 7로 19점을 깎았는데도 domain 18 + growth 20이 끌어올려 72점이 됐다 —
 * 발송 기준(70)을 넘는 점수다. role·conditions를 0으로 깎아도 53점이 바닥이라
 * 축 점수만으로는 이 구조를 벗어날 수 없다.
 *
 * "내가 할 수 있는 일인가"와 "좋은 회사인가"는 대칭이 아니다. 회사가 아무리 좋아도
 * 직무가 다르면 지원 자체가 성립하지 않는데, 총점 합산은 그 둘을 같은 무게로 섞는다.
 * 그래서 role만 별도의 문턱으로 둔다.
 *
 * 5인 이유(실측, 제외되지 않은 127건 기준): role<=5는 11건이 걸리고 전부 실제로
 * 맞지 않는 공고였다(주니어 프론트엔드, 2~7년, 풀스택 개발자, QA 엔지니어).
 * role<=8로 올리면 54건이 걸려 정상 공고까지 쓸어간다.
 */
const AUTO_HIDE_MAX_ROLE = 5

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
      const roleScore = item.breakdown.role ?? Number.POSITIVE_INFINITY
      if (item.total <= AUTO_HIDE_MAX_SCORE || roleScore <= AUTO_HIDE_MAX_ROLE) {
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

import { z } from 'zod'
import { MAX_AXIS_SCORE, RUBRIC_AXES } from './rubric.js'

const axisScore = z.number().int().min(0).max(MAX_AXIS_SCORE)

const breakdownSchema = z
  .object(Object.fromEntries(RUBRIC_AXES.map((a) => [a, axisScore])) as
    Record<(typeof RUBRIC_AXES)[number], typeof axisScore>)
  .strict()

export const scoreItemSchema = z
  .object({
    jobId: z.string().uuid(),
    total: z.number().int().min(0).max(RUBRIC_AXES.length * MAX_AXIS_SCORE),
    breakdown: breakdownSchema,
    reasoning: z.string().min(1),
    /** 공고가 어떤 일인지 한 문장. 목록 카드에 그대로 실린다. */
    summary: z.string().min(1).max(140),
  })
  .refine(
    (v) => Object.values(v.breakdown).reduce((a, b) => a + b, 0) === v.total,
    { message: 'total이 breakdown 합계와 일치해야 합니다' },
  )

export type ScoreItem = z.infer<typeof scoreItemSchema>

export const scoreSubmissionSchema = z.array(scoreItemSchema)
export type ScoreSubmission = z.infer<typeof scoreSubmissionSchema>

const jobIdRefSchema = z.object({ jobId: z.string().uuid() })

export type ScoreItemParse =
  | { ok: true; item: ScoreItem }
  | { ok: false; jobId: string | null; reason: string }

/**
 * 제출 배열을 통째로 parse하면 한 건의 형식 오류가 나머지 전부를 되돌려보내고,
 * 그 20건이 다음 밤에도 그대로 다시 배달돼 채점 큐가 영원히 진행되지 않는다.
 * 그래서 항목 단위로 나눠 받는다. jobId만이라도 읽히면 그 건에 실패를 기록해
 * attempts를 올릴 수 있으므로 실패 결과에 함께 담는다.
 */
export function parseScoreItem(raw: unknown): ScoreItemParse {
  const parsed = scoreItemSchema.safeParse(raw)
  if (parsed.success) return { ok: true, item: parsed.data }

  const reason = parsed.error.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ')
  const idOnly = jobIdRefSchema.safeParse(raw)
  return { ok: false, jobId: idOnly.success ? idOnly.data.jobId : null, reason }
}

export const pendingJobSchema = z.object({
  id: z.string(),
  position: z.string(),
  companyName: z.string(),
  url: z.string(),
  intro: z.string().nullable(),
  requirements: z.string().nullable(),
  mainTasks: z.string().nullable(),
  preferredPoints: z.string().nullable(),
  benefits: z.string().nullable(),
  skillTags: z.array(z.string()),
})

export const pendingPayloadSchema = z.object({
  profile: z.object({ resumeText: z.string(), rubricVersion: z.string() }),
  rubric: z.string(),
  jobs: z.array(pendingJobSchema),
})
export type PendingPayload = z.infer<typeof pendingPayloadSchema>

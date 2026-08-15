import { z } from 'zod'
import { MAX_AXIS_SCORE, RUBRIC_AXES } from './rubric.js'

const axisScore = z.number().int().min(0).max(MAX_AXIS_SCORE)

const breakdownSchema = z
  .object(Object.fromEntries(RUBRIC_AXES.map((a) => [a, axisScore])) as
    Record<(typeof RUBRIC_AXES)[number], typeof axisScore>)
  .strict()

const singleSubmission = z
  .object({
    jobId: z.string().uuid(),
    total: z.number().int().min(0).max(RUBRIC_AXES.length * MAX_AXIS_SCORE),
    breakdown: breakdownSchema,
    reasoning: z.string().min(1),
  })
  .refine(
    (v) => Object.values(v.breakdown).reduce((a, b) => a + b, 0) === v.total,
    { message: 'total이 breakdown 합계와 일치해야 합니다' },
  )

export const scoreSubmissionSchema = z.array(singleSubmission)
export type ScoreSubmission = z.infer<typeof scoreSubmissionSchema>

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

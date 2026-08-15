import { RUBRIC_VERSION, loadRubric, toPendingJob } from '@job-finder/scoring'
import { getStore } from '@/lib/store'
import { requireBearer } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** routine 한 번이 감당할 만한 상한. 남으면 다음 실행이 가져간다. */
const BATCH = 20

export async function GET(req: Request) {
  const denied = requireBearer(req, process.env.SCORING_TOKEN)
  if (denied) return denied

  const store = getStore()
  const [profile, jobs] = await Promise.all([
    store.getProfile(),
    store.listJobsNeedingScore(BATCH),
  ])

  return Response.json({
    profile: { resumeText: profile.resumeText, rubricVersion: RUBRIC_VERSION },
    rubric: loadRubric(),
    jobs: jobs.map(toPendingJob),
  })
}

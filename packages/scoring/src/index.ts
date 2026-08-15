import type { Job } from '@job-finder/db'
import type { PendingPayload } from './schema.js'

export * from './rubric.js'
export * from './schema.js'

export function toPendingJob(job: Job): PendingPayload['jobs'][number] {
  return {
    id: job.id,
    position: job.position,
    companyName: job.companyName,
    url: job.url,
    intro: job.intro ?? null,
    requirements: job.requirements ?? null,
    mainTasks: job.mainTasks ?? null,
    preferredPoints: job.preferredPoints ?? null,
    benefits: job.benefits ?? null,
    skillTags: job.skillTags ?? [],
  }
}

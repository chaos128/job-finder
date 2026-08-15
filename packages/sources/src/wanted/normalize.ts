import type { JobDetailFields } from '@job-finder/db'
import { z } from 'zod'
import type { ExternalRef, RawDetail } from '../types.js'

const listItemSchema = z.object({
  id: z.number(),
  position: z.string(),
  company: z.object({ id: z.number().nullable().optional(), name: z.string() }),
  address: z.object({
    district: z.string().nullable().optional(),
    full_location: z.string().nullable().optional(),
  }).nullable().optional(),
  due_time: z.string().nullable().optional(),
})

const listPageSchema = z.object({
  data: z.array(listItemSchema),
  links: z.object({ next: z.string().nullable() }).optional(),
})

const detailSchema = z.object({
  job: z.object({
    id: z.number(),
    detail: z.object({
      intro: z.string().nullable().optional(),
      requirements: z.string().nullable().optional(),
      main_tasks: z.string().nullable().optional(),
      preferred_points: z.string().nullable().optional(),
      benefits: z.string().nullable().optional(),
    }),
    skill_tags: z.array(z.object({ title: z.string() })).nullable().optional(),
  }),
})

/** jobs.due_time is a Postgres `date` column: keep only the YYYY-MM-DD prefix, else null. */
function normalizeDueTime(raw: string | null | undefined): string | null {
  if (!raw) return null
  const match = /^\d{4}-\d{2}-\d{2}/.exec(raw)
  return match ? match[0] : null
}

export function parseListPage(payload: unknown): {
  refs: ExternalRef[]
  nextPath: string | null
} {
  const parsed = listPageSchema.parse(payload)
  const refs = parsed.data.map((item): ExternalRef => ({
    externalId: String(item.id),
    job: {
      externalId: String(item.id),
      position: item.position,
      companyName: item.company.name,
      companyId: item.company.id ?? null,
      addressDistrict: item.address?.district ?? null,
      addressFull: item.address?.full_location ?? null,
      url: `https://www.wanted.co.kr/wd/${item.id}`,
      dueTime: normalizeDueTime(item.due_time),
    },
  }))
  return { refs, nextPath: parsed.links?.next ?? null }
}

export function normalizeWantedDetail(raw: RawDetail): JobDetailFields {
  const parsed = detailSchema.parse(raw.payload)
  const d = parsed.job.detail
  return {
    intro: d.intro ?? null,
    requirements: d.requirements ?? null,
    mainTasks: d.main_tasks ?? null,
    preferredPoints: d.preferred_points ?? null,
    benefits: d.benefits ?? null,
    skillTags: (parsed.job.skill_tags ?? []).map((t) => t.title),
    raw: raw.payload,
  }
}

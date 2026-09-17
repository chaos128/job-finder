import type { JobDetailFields } from '@job-finder/db'
import { z } from 'zod'
import { normalizeDueTime } from '../date.js'
import type { ExternalRef, JobOpenState, RawDetail } from '../types.js'
import { REMEMBER_JOB_URL_BASE } from './parse-url.js'

/** formatExperience가 "N년 이상"으로 읽는 센티널. Wanted가 쓰는 값과 같아야 한다. */
const NO_UPPER_BOUND = 100

const listItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  organization: z.object({
    name: z.string(),
    company_id: z.number().nullable().optional(),
  }),
  normalized_address: z.object({
    level1: z.string().nullable().optional(),
    level2: z.string().nullable().optional(),
  }).nullable().optional(),
  addresses: z.array(z.object({
    address_level1: z.string().nullable().optional(),
    address_level2: z.string().nullable().optional(),
  })).nullable().optional(),
  ends_at: z.string().nullable().optional(),
})

/**
 * 서버가 실제로 해석한 필터가 여기로 그대로 돌아온다. 우리가 보낸 이름이 틀리면
 * 400이 아니라 이 자리에 null이 오고 결과는 필터 없는 전량이 된다.
 */
const echoSchema = z.object({
  organization_type: z.unknown().nullable().optional(),
  min_experience: z.unknown().nullable().optional(),
  addresses: z.unknown().nullable().optional(),
  job_category_ids: z.array(z.unknown()).nullable().optional(),
}).passthrough()

const listPageSchema = z.object({
  data: z.array(listItemSchema),
  meta: z.object({
    page: z.number(),
    total_pages: z.number(),
    logger_info: z.object({
      query_meta_data: z.object({ search: echoSchema }),
    }).optional(),
  }),
})

const detailSchema = z.object({
  data: z.object({
    id: z.number(),
    status: z.string().nullable().optional(),
    ends_at: z.string().nullable().optional(),
    min_experience: z.number().nullable().optional(),
    max_experience: z.number().nullable().optional(),
    introduction: z.string().nullable().optional(),
    qualifications: z.string().nullable().optional(),
    job_description: z.string().nullable().optional(),
    preferred_qualifications: z.string().nullable().optional(),
    additional_information: z.string().nullable().optional(),
  }),
})

function addressFull(item: z.infer<typeof listItemSchema>): string | null {
  const a = item.addresses?.[0]
  if (!a) return null
  return [a.address_level1, a.address_level2].filter(Boolean).join(' ') || null
}

export interface RememberListPage {
  refs: ExternalRef[]
  page: number
  totalPages: number
  /** 서버가 무시한 필터 이름. 비어 있지 않으면 수집을 진행하면 안 된다. */
  ignoredFilters: string[]
}

export function parseRememberListPage(payload: unknown): RememberListPage {
  const parsed = listPageSchema.parse(payload)
  const echo = parsed.meta.logger_info?.query_meta_data.search

  const ignoredFilters: string[] = []
  if (echo) {
    // job_category_names는 서버가 id로 바꿔 돌려주므로(job_category_ids) 이름이 아니라
    // id 배열이 비었는지로 본다. 나머지는 보낸 값이 그대로 돌아온다.
    if (echo.organization_type == null) ignoredFilters.push('organization_type')
    if (echo.min_experience == null) ignoredFilters.push('min_experience')
    if (echo.addresses == null) ignoredFilters.push('addresses')
    if (!echo.job_category_ids?.length) ignoredFilters.push('job_category_names')
  }

  const refs = parsed.data.map((item): ExternalRef => ({
    externalId: String(item.id),
    job: {
      externalId: String(item.id),
      position: item.title,
      companyName: item.organization.name,
      companyId: item.organization.company_id ?? null,
      addressDistrict: item.normalized_address?.level2 ?? null,
      addressFull: addressFull(item),
      url: `${REMEMBER_JOB_URL_BASE}/${item.id}`,
      dueTime: normalizeDueTime(item.ends_at),
    },
  }))

  return { refs, page: parsed.meta.page, totalPages: parsed.meta.total_pages, ignoredFilters }
}

export function normalizeRememberDetail(raw: RawDetail): JobDetailFields {
  const j = detailSchema.parse(raw.payload).data
  return {
    // 상한 없음(null)을 Wanted와 같은 센티널로 맞춘다 — 그래야 formatExperience와
    // 그 테스트가 두 소스를 한 규칙으로 덮는다.
    annualFrom: j.min_experience ?? 0,
    annualTo: j.max_experience ?? NO_UPPER_BOUND,
    intro: j.introduction ?? null,
    requirements: j.qualifications ?? null,
    mainTasks: j.job_description ?? null,
    preferredPoints: j.preferred_qualifications ?? null,
    benefits: j.additional_information ?? null,
    // Remember에는 기술 태그가 없다. job_categories는 직무 분류지 스택이 아니라,
    // 채점 프롬프트에 스택으로 넘기면 루틴이 잘못 읽는다. 스택은 qualifications 본문에 있다.
    skillTags: [],
    raw: raw.payload,
  }
}

/** Wanted는 'close', Remember는 'closed'다. 모르는 값은 열린 것으로 둔다. */
export function parseRememberOpenState(raw: RawDetail): JobOpenState {
  const j = detailSchema.parse(raw.payload).data
  return { closed: j.status === 'closed', dueTime: normalizeDueTime(j.ends_at) }
}

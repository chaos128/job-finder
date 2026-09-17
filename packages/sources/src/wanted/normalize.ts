import type { JobDetailFields } from '@job-finder/db'
import { z } from 'zod'
import { normalizeDueTime } from '../date.js'
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
    // 화면의 "경력 5년 이상"에 해당한다. 없는 응답이 있어도 상세 저장 전체를
    // 실패시키지 않도록 optional로 둔다(경력은 부가 정보다).
    annual_from: z.number().nullable().optional(),
    annual_to: z.number().nullable().optional(),
    // 모집 마감 여부. 목록에서 내려온 due_time과 달리 이 값만이 "닫혔다"를 말해준다 —
    // 실측에서 마감일이 미래인데 status가 close인 공고가 있었다.
    status: z.string().nullable().optional(),
    due_time: z.string().nullable().optional(),
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
    annualFrom: parsed.job.annual_from ?? null,
    annualTo: parsed.job.annual_to ?? null,
    intro: d.intro ?? null,
    requirements: d.requirements ?? null,
    mainTasks: d.main_tasks ?? null,
    preferredPoints: d.preferred_points ?? null,
    benefits: d.benefits ?? null,
    skillTags: (parsed.job.skill_tags ?? []).map((t) => t.title),
    raw: raw.payload,
  }
}

/** 재확인 결과. closed면 목록에서 제외하고, dueTime은 화면 표시를 최신으로 맞춘다. */
export interface JobOpenState {
  closed: boolean
  dueTime: string | null
}

/**
 * 상세 응답에서 모집 상태만 뽑는다.
 *
 * `status === 'close'`일 때만 닫힌 것으로 본다 — 모르는 값이 오면 열린 것으로 둬서
 * 표기가 바뀌었을 때 멀쩡한 공고를 무더기로 숨기지 않게 한다. 마감일(dueTime)은
 * 판단에 쓰지 않고 표시용으로만 갱신한다: 저장된 마감이 지났어도 연장되는 경우가
 * 실제로 있어서(실측 7건 중 1건), 날짜로 판단하면 열려 있는 공고를 숨기게 된다.
 */
export function parseJobOpenState(raw: RawDetail): JobOpenState {
  const parsed = detailSchema.parse(raw.payload)
  return {
    closed: parsed.job.status === 'close',
    dueTime: normalizeDueTime(parsed.job.due_time),
  }
}

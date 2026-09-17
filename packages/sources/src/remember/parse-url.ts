import type { RememberSearchParams } from '@job-finder/db'
import { z } from 'zod'

export const REMEMBER_API_BASE = 'https://career-api.rememberapp.co.kr'
export const REMEMBER_JOB_URL_BASE = 'https://career.rememberapp.co.kr/job/postings'

/** 화면의 정렬 드롭다운 '최신순'에 해당한다. 수집은 최신부터 보는 게 맞다. */
const SORT = 'starts_at_desc'

const searchJsonSchema = z.object({
  jobCategoryNames: z.array(z.object({ level1: z.string(), level2: z.string() })).optional(),
  addresses: z.array(z.array(z.string())).optional(),
  organizationType: z.string().nullable().optional(),
  minExperience: z.number().nullable().optional(),
})

export function parseRememberSearchUrl(input: string): RememberSearchParams {
  const raw = new URL(input).searchParams.get('search')
  if (!raw) throw new Error(`Remember 검색 URL이 아닙니다 (search 파라미터 필요): ${input}`)

  const parsed = searchJsonSchema.parse(JSON.parse(raw))
  return {
    source: 'remember',
    jobCategoryNames: parsed.jobCategoryNames ?? [],
    addresses: parsed.addresses ?? [],
    organizationType: parsed.organizationType ?? null,
    minExperience: parsed.minExperience ?? null,
  }
}

/**
 * 저장된 파라미터(camelCase, 페이지 URL과 같은 모양)를 API 본문(snake_case)으로 옮긴다.
 *
 * 자동 케이스 변환 함수를 쓰지 않는 이유: 이름이 틀리면 API가 400을 주지 않고
 * **그 필터만 조용히 무시한 채 200을 돌려준다**(실측에서 122건이 12,894건이 됐다).
 * 변환표가 한 곳에 명시적으로 적혀 있어야 눈으로 대조할 수 있다.
 */
export function buildRememberSearchBody(
  params: RememberSearchParams,
  page: { page: number; per: number },
): Record<string, unknown> {
  return {
    search: {
      job_category_names: params.jobCategoryNames,
      addresses: params.addresses,
      organization_type: params.organizationType,
      min_experience: params.minExperience,
    },
    page: page.page,
    per: page.per,
    sort: SORT,
  }
}

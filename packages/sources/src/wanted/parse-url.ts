import type { SearchParams } from '@job-finder/db'

/** Wanted API가 받아주는 연차 상한. UI는 20까지 만들지만 API는 422로 거부한다. */
export const MAX_YEARS = 10

const API_BASE = 'https://www.wanted.co.kr/api/v4/jobs'

export function parseWantedSearchUrl(input: string): SearchParams {
  const url = new URL(input)
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0] !== 'wdlist' || !segments[1]) {
    throw new Error(`Wanted 검색 URL이 아닙니다 (wdlist 경로 필요): ${input}`)
  }

  const rawYears = url.searchParams.getAll('years')
    .map((v) => Number.parseInt(v, 10))
    .filter((n) => Number.isFinite(n))

  const clamped = rawYears.map((n) => Math.min(Math.max(n, 0), MAX_YEARS))
  const yearsFrom = clamped.length > 0 ? Math.min(...clamped) : 0
  const yearsTo = clamped.length > 1 ? Math.max(...clamped) : MAX_YEARS

  return {
    jobGroupId: segments[1],
    tagTypeIds: segments[2] ? [segments[2]] : [],
    locations: url.searchParams.getAll('locations'),
    yearsFrom,
    yearsTo,
    country: url.searchParams.get('country') ?? 'kr',
    sort: url.searchParams.get('job_sort') ?? 'job.latest_order',
  }
}

export function buildWantedListUrl(
  params: SearchParams,
  page: { limit: number; offset: number },
): string {
  const url = new URL(API_BASE)
  url.searchParams.set('country', params.country)
  url.searchParams.set('job_sort', params.sort)
  for (const id of params.tagTypeIds) url.searchParams.append('tag_type_ids', id)
  for (const loc of params.locations) url.searchParams.append('locations', loc)
  url.searchParams.append('years', String(params.yearsFrom))
  url.searchParams.append('years', String(params.yearsTo))
  url.searchParams.set('limit', String(page.limit))
  url.searchParams.set('offset', String(page.offset))
  return url.toString()
}

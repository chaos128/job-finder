import type { JobDetailFields, NewJob, SearchParams } from '@job-finder/db'

export interface ExternalRef {
  externalId: string
  job: Omit<NewJob, 'source'>
}

export interface RawDetail {
  externalId: string
  payload: unknown
}

export interface JobSource {
  readonly id: 'wanted'
  parseSearchUrl(url: string): SearchParams
  listRefs(params: SearchParams): AsyncIterable<ExternalRef>
  fetchDetail(externalId: string): Promise<RawDetail>
  normalize(raw: RawDetail): JobDetailFields
}

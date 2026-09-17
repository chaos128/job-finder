import type { JobDetailFields, NewJob, SearchParams, Source } from '@job-finder/db'

export interface ExternalRef {
  externalId: string
  job: Omit<NewJob, 'source'>
}

export interface RawDetail {
  externalId: string
  payload: unknown
}

/** 재확인 결과. closed면 목록에서 제외하고, dueTime은 화면 표시를 최신으로 맞춘다. */
export interface JobOpenState {
  closed: boolean
  dueTime: string | null
}

export interface JobSource {
  readonly id: Source
  parseSearchUrl(url: string): SearchParams
  listRefs(params: SearchParams): AsyncIterable<ExternalRef>
  fetchDetail(externalId: string): Promise<RawDetail>
  normalize(raw: RawDetail): JobDetailFields
  /**
   * 마감 여부는 소스마다 표기가 다르다 — Wanted는 'close', Remember는 'closed'다.
   * 자유 함수로 두면 recheck 노드가 어떤 소스의 payload든 Wanted 스키마로 파싱한다.
   */
  parseOpenState(raw: RawDetail): JobOpenState
}

/** 소스 id로 구현을 고르는 표. 노드는 처리 중인 행의 source로 여기서 꺼낸다. */
export type SourceRegistry = Partial<Record<Source, JobSource>>

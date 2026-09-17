import type { NewJob, Search, Store } from '@job-finder/db'
import { SourceHttpError, type ExternalRef, type SourceRegistry } from '@job-finder/sources'
import { findDuplicate } from '../core/dedup.js'
import { fail, ok, type Node } from '../core/node.js'

export interface DiscoverResult {
  searchId: string
  /** 이번 페이징에서 본 공고 수 (신규 + 기존) */
  found: number
  /** 이번에 새로 저장된 공고 수 */
  created: number
  /** 이번에 중복으로 표시한 공고 수. */
  duplicates: number
}

export function createDiscoverNode(
  deps: { store: Store; sources: SourceRegistry },
): Node<Search, DiscoverResult> {
  return {
    name: 'discover',

    async run(search) {
      const source = deps.sources[search.source]
      if (!source) return fail('UNKNOWN_SOURCE', `등록되지 않은 소스: ${search.source}`, false)
      // search.source(라우팅 컬럼)와 search.params.source(유니온 판별자)는 각자 따로
      // 값을 바꿀 수 있는 별개 필드다. 어긋나면 엉뚱한 구현이 잘못된 모양의 params를
      // 받아 조용히 쓰레기 URL을 만들 수 있으므로, 조용히 틀리는 대신 여기서 실패한다.
      // params는 DB에서 `jsonb not null`이지만 `'null'::jsonb`(JS null)까지 막지는
      // 않고, 검색 행은 사람이 SQL Editor로 손수 넣는다 — ?.로 접근해 그 값도
      // try 밖에서 node를 throw시키지 않고 SOURCE_MISMATCH로 눕힌다.
      if (search.params?.source !== search.source) {
        return fail(
          'SOURCE_MISMATCH',
          `search.source(${search.source})와 search.params.source(${search.params?.source})가 다르다`,
          false,
        )
      }

      const refs: ExternalRef[] = []
      try {
        for await (const ref of source.listRefs(search.params)) refs.push(ref)
      } catch (cause) {
        if (cause instanceof SourceHttpError) {
          return fail('SOURCE_HTTP', cause.message, cause.retryable)
        }
        return fail('DISCOVER_FAILED', String(cause), false)
      }

      try {
        const externalIds = refs.map((r) => r.externalId)
        const known = await deps.store.findJobIdsByExternalIds(source.id, externalIds)

        const rows: NewJob[] = refs
          .filter((r) => !known.has(r.externalId))
          .map((r) => ({ source: source.id, ...r.job }))

        // 인덱스를 insert **전에** 읽는다. 뒤에 읽으면 같은 배치의 새 행끼리
        // 서로를 중복으로 지목한다.
        const dedupIndex = await deps.store.listDedupIndex()
        const created = await deps.store.insertJobs(rows)

        const jobIds = [...known.values(), ...created.map((j) => j.id)]
        await deps.store.linkSearchHits(search.id, jobIds)

        const pairs = created.flatMap((job) => {
          const original = findDuplicate(job, dedupIndex)
          return original ? [{ jobId: job.id, duplicateOf: original.id }] : []
        })
        if (pairs.length > 0) await deps.store.markDuplicates(pairs)

        return ok({
          searchId: search.id, found: refs.length, created: created.length,
          duplicates: pairs.length,
        })
      } catch (cause) {
        // DB 계층 실패는 일시적 장애로 본다 — Wanted가 파라미터를 거부한 것과
        // 혼동되지 않도록 별도 코드로 분류해, 대시보드가 검색을 잘못 비활성화하지 않게 한다.
        return fail('STORE_FAILED', String(cause), true)
      }
    },
  }
}

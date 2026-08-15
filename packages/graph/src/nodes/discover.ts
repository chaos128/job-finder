import type { NewJob, Search, Store } from '@job-finder/db'
import { WantedHttpError, type ExternalRef, type JobSource } from '@job-finder/sources'
import { fail, ok, type Node } from '../core/node.js'

export interface DiscoverResult {
  searchId: string
  /** 이번 페이징에서 본 공고 수 (신규 + 기존) */
  found: number
  /** 이번에 새로 저장된 공고 수 */
  created: number
}

export function createDiscoverNode(
  deps: { store: Store; source: JobSource },
): Node<Search, DiscoverResult> {
  return {
    name: 'discover',

    async run(search) {
      const refs: ExternalRef[] = []
      try {
        for await (const ref of deps.source.listRefs(search.params)) refs.push(ref)
      } catch (cause) {
        if (cause instanceof WantedHttpError) {
          return fail('WANTED_HTTP', cause.message, cause.retryable)
        }
        return fail('DISCOVER_FAILED', String(cause), false)
      }

      const externalIds = refs.map((r) => r.externalId)
      const known = await deps.store.findJobIdsByExternalIds(deps.source.id, externalIds)

      const rows: NewJob[] = refs
        .filter((r) => !known.has(r.externalId))
        .map((r) => ({ source: deps.source.id, ...r.job }))

      const created = await deps.store.insertJobs(rows)

      const jobIds = [...known.values(), ...created.map((j) => j.id)]
      await deps.store.linkSearchHits(search.id, jobIds)

      return ok({ searchId: search.id, found: refs.length, created: created.length })
    },
  }
}

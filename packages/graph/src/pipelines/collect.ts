import type { RunTrigger, Store } from '@job-finder/db'
import type { JobSource } from '@job-finder/sources'
import { createDiscoverNode } from '../nodes/discover.js'
import { createFetchDetailNode } from '../nodes/fetch-detail.js'
import { runNode, type FailedItem } from '../core/runner.js'

export interface CollectReport {
  runId: string
  searches: number
  found: number
  created: number
  detailed: number
  failed: FailedItem[]
}

/** 한 번의 호출에서 상세를 가져올 최대 건수. Vercel 함수 제한 안에 들어가도록 잡았다. */
const DEFAULT_DETAIL_LIMIT = 50

export async function runCollect(
  deps: { store: Store; source: JobSource },
  trigger: RunTrigger,
  opts: { detailLimit?: number } = {},
): Promise<CollectReport> {
  const { store, source } = deps
  const runId = await store.startRun(trigger)

  try {
    const searches = await store.listEnabledSearches()
    const discovered = await runNode(
      createDiscoverNode({ store, source }),
      searches,
      (s) => s.id,
      { runId, store },
    )

    const pending = await store.listJobsNeedingDetail(opts.detailLimit ?? DEFAULT_DETAIL_LIMIT)
    const detailed = await runNode(
      createFetchDetailNode({ store, source }),
      pending,
      (job) => job.id,
      { runId, store },
    )

    return {
      runId,
      searches: searches.length,
      found: discovered.ok.reduce((sum, r) => sum + r.found, 0),
      created: discovered.ok.reduce((sum, r) => sum + r.created, 0),
      detailed: detailed.ok.length,
      failed: [...discovered.failed, ...detailed.failed],
    }
  } finally {
    await store.endRun(runId)
  }
}

import type { RunTrigger, Store } from '@job-finder/db'
import type { JobSource } from '@job-finder/sources'
import { createDiscoverNode } from '../nodes/discover.js'
import { createFetchDetailNode } from '../nodes/fetch-detail.js'
import { runNode, type FailedItem } from '../core/runner.js'

/** failed 배열의 각 항목이 discover/fetchDetail 중 어느 단계에서 났는지 태그한다. */
export interface CollectFailedItem extends FailedItem {
  node: 'discover' | 'fetchDetail'
}

export interface CollectReport {
  runId: string
  searches: number
  found: number
  created: number
  detailed: number
  /** true면 상세 조회가 limit을 다 채운 것 — 아직 남은 건이 더 있을 수 있다. */
  hitDetailLimit: boolean
  failed: CollectFailedItem[]
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

    const detailLimit = opts.detailLimit ?? DEFAULT_DETAIL_LIMIT
    const pending = await store.listJobsNeedingDetail(detailLimit)
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
      hitDetailLimit: pending.length === detailLimit,
      failed: [
        ...discovered.failed.map((f): CollectFailedItem => ({ ...f, node: 'discover' })),
        ...detailed.failed.map((f): CollectFailedItem => ({ ...f, node: 'fetchDetail' })),
      ],
    }
  } finally {
    try {
      await store.endRun(runId)
    } catch {
      // endRun은 관측용 마무리 기록이다 — 이게 실패했다고 이미 만든 report를
      // 날리거나(성공 케이스), 본문에서 던진 진짜 에러를 가려서는(실패 케이스) 안 된다.
    }
  }
}

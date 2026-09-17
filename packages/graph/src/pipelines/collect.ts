import type { RunTrigger, Store } from '@job-finder/db'
import { findCompanyRating, type SourceRegistry } from '@job-finder/sources'
import { createCompanyRatingNode, type FindRating } from '../nodes/company-rating.js'
import { createDiscoverNode } from '../nodes/discover.js'
import { createRecheckNode } from '../nodes/recheck.js'
import { createFetchDetailNode } from '../nodes/fetch-detail.js'
import { runNode, type FailedItem } from '../core/runner.js'

/** failed 배열의 각 항목이 어느 단계에서 났는지 태그한다. */
export interface CollectFailedItem extends FailedItem {
  node: 'discover' | 'fetchDetail' | 'companyRating' | 'recheck'
}

export interface CollectReport {
  runId: string
  searches: number
  found: number
  created: number
  /** 이번 실행에서 중복으로 표시한 공고 수. */
  duplicates: number
  detailed: number
  /** Blind 별점을 새로 확정한 회사 수(미등록으로 확정한 것도 포함). */
  rated: number
  /** 모집 마감 여부를 다시 확인한 공고 수(닫혀서 제외된 것도 포함). */
  rechecked: number
  /** true면 상세 조회가 limit을 다 채운 것 — 아직 남은 건이 더 있을 수 있다. */
  hitDetailLimit: boolean
  failed: CollectFailedItem[]
}

/** 한 번의 호출에서 상세를 가져올 최대 건수. Vercel 함수 제한 안에 들어가도록 잡았다. */
const DEFAULT_DETAIL_LIMIT = 50

/**
 * 한 번의 호출에서 별점을 조회할 최대 회사 수. 회사 하나에 Blind 검색 요청이
 * 최대 3번(원문 → 괄호 제거 → 별칭) 나가므로 이 값이 곧 요청 상한 ×3이다.
 * 첫 실행에는 187곳이 대기하지만 다 채우지 않는다 — 남은 회사는 다음 밤이
 * 이어받는다(백로그가 자연히 빠지는, 채점 큐와 같은 방식).
 */
const DEFAULT_RATING_LIMIT = 40

/**
 * 한 번의 호출에서 마감 여부를 다시 확인할 공고 수. 건마다 상세 API를 한 번 부른다.
 * 비제외 공고가 130건 남짓이고 주기가 7일이라, 40건이면 한 바퀴가 나흘쯤 걸린다.
 */
const DEFAULT_RECHECK_LIMIT = 40

/** 같은 공고를 다시 확인하기까지의 간격. 모집 상태가 하루 단위로 뒤집히지는 않는다. */
const RECHECK_STALE_DAYS = 7

/** 별점 조회는 남의 서버를 두드리는 일이라 상세 조회보다 더 얌전하게 굴린다. */
const RATING_CONCURRENCY = 2

/**
 * 별점을 다시 확인하는 주기. 회사 평점은 하루 단위로 흔들리는 값이 아니다.
 * 백필 CLI가 "아직 남은 회사"를 셀 때도 같은 값을 써야 한다 — 그래서 export한다.
 */
export const RATING_STALE_DAYS = 30

export async function runCollect(
  deps: { store: Store; sources: SourceRegistry; findRating?: FindRating },
  trigger: RunTrigger,
  opts: { detailLimit?: number; ratingLimit?: number; recheckLimit?: number } = {},
): Promise<CollectReport> {
  const { store, sources } = deps
  const runId = await store.startRun('collect', trigger)

  try {
    const searches = await store.listEnabledSearches()
    const discovered = await runNode(
      createDiscoverNode({ store, sources }),
      searches,
      (s) => s.id,
      { runId, store },
    )

    const detailLimit = opts.detailLimit ?? DEFAULT_DETAIL_LIMIT
    const pending = await store.listJobsNeedingDetail(detailLimit)
    const detailed = await runNode(
      createFetchDetailNode({ store, sources }),
      pending,
      (job) => job.id,
      { runId, store },
    )

    // 이미 아는 공고가 아직 열려 있는지 다시 본다. 수집과 독립이라 실패해도
    // 수집 결과를 버리지 않는다.
    const stale = await store.listJobsNeedingRecheck(
      opts.recheckLimit ?? DEFAULT_RECHECK_LIMIT, RECHECK_STALE_DAYS,
    )
    const rechecked = await runNode(
      createRecheckNode({ store, sources }),
      stale,
      (j) => j.id,
      { runId, store },
    )

    // 별점은 공고 수집과 독립이다 — 실패해도 수집 결과를 버리지 않는다.
    const companies = await store.listCompaniesNeedingRating(
      opts.ratingLimit ?? DEFAULT_RATING_LIMIT, RATING_STALE_DAYS,
    )
    const rated = await runNode(
      createCompanyRatingNode({ store, findRating: deps.findRating ?? findCompanyRating }),
      companies,
      (name) => name,
      { runId, store, concurrency: RATING_CONCURRENCY },
    )

    return {
      runId,
      searches: searches.length,
      found: discovered.ok.reduce((sum, r) => sum + r.found, 0),
      created: discovered.ok.reduce((sum, r) => sum + r.created, 0),
      duplicates: discovered.ok.reduce((sum, r) => sum + r.duplicates, 0),
      detailed: detailed.ok.length,
      rated: rated.ok.length,
      rechecked: rechecked.ok.length,
      hitDetailLimit: pending.length === detailLimit,
      failed: [
        ...discovered.failed.map((f): CollectFailedItem => ({ ...f, node: 'discover' })),
        ...detailed.failed.map((f): CollectFailedItem => ({ ...f, node: 'fetchDetail' })),
        ...rated.failed.map((f): CollectFailedItem => ({ ...f, node: 'companyRating' })),
        ...rechecked.failed.map((f): CollectFailedItem => ({ ...f, node: 'recheck' })),
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

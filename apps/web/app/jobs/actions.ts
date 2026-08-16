'use server'

import type { DashboardCursor, DashboardFilters, DashboardPage, UnscoredJob } from '@job-finder/db'
import { revalidatePath } from 'next/cache'
import { getStore } from '@/lib/store'
import { PAGE_SIZE, UNSCORED_LIMIT } from './constants'

/**
 * 새 JSON API 라우트를 만들지 않고 Server Action을 쓴다 — 페이지가 공개라
 * 조회용 엔드포인트를 늘리면 표면만 넓어진다.
 */
export async function loadMoreJobs(
  filters: DashboardFilters, cursor?: DashboardCursor,
): Promise<DashboardPage> {
  return getStore().listDashboardJobs({ ...filters, cursor, limit: PAGE_SIZE })
}

export async function toggleBookmark(jobId: string, next: boolean): Promise<void> {
  await getStore().setJobBookmarked(jobId, next)
  // 북마크를 보여주는 라우트만 무효화한다 — `/`는 랜딩이라 북마크가 없다.
  revalidatePath('/jobs')
  revalidatePath(`/jobs/${jobId}`)
}

/** 토글이 켜질 때만 호출된다 — 채점된 목록의 질의와는 무관한 별도 구간이다. */
export async function loadUnscoredJobs(): Promise<UnscoredJob[]> {
  return getStore().listUnscoredJobs(UNSCORED_LIMIT)
}

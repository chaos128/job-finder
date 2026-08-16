import { isExpired } from '@job-finder/graph'
import { getStore } from '@/lib/store'
import { PAGE_SIZE } from './constants'
import { JobList } from './_components/job-list'
import { StatusStrip } from '../_components/status-strip'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const store = getStore()
  const [stats, first, profile] = await Promise.all([
    store.getDashboardStats(),
    store.listDashboardJobs({ limit: PAGE_SIZE }),
    store.getProfile(),
  ])
  const now = new Date()
  const pending = await store.listDashboardJobs({
    limit: 500, minScore: profile.notifyRule.minScore, unnotifiedOnly: true,
  })
  // listDashboardJobs에는 due_time 필터가 없다 — notify가 실제로 고를 양과 맞추려면
  // selectForDigest와 같은 만료 판정(isExpired)을 여기서도 적용해야 한다. 안 그러면
  // 마감 지난 공고가 "알림 대기"에 영원히 남는다.
  const pendingCount = pending.rows.filter((row) => !isExpired(row.dueTime, now)).length

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <h1 className="text-2xl font-bold">Job Finder</h1>
      <StatusStrip stats={stats} pendingNotify={pendingCount} now={now} />
      <JobList initialRows={first.rows} initialCursor={first.nextCursor} />
    </main>
  )
}

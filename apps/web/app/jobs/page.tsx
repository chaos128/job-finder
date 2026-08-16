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
      {/* TopBar가 이미 "Job Finder" 브랜드를 보여준다 — 여기서는 페이지 고유의 제목만 둔다. */}
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">채점된 공고</h1>
        <p className="text-neutral-600">점수 순으로 정렬돼 있다. 최소 점수·북마크·발송 여부로 좁혀볼 수 있다.</p>
      </header>
      <StatusStrip stats={stats} pendingNotify={pendingCount} now={now} />
      <JobList initialRows={first.rows} initialCursor={first.nextCursor} />
    </main>
  )
}

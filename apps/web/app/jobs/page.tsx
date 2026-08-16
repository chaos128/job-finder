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
  const pending = await store.listDashboardJobs({
    limit: 500, minScore: profile.notifyRule.minScore, unnotifiedOnly: true,
  })

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <h1 className="text-2xl font-bold">Job Finder</h1>
      <StatusStrip stats={stats} pendingNotify={pending.rows.length} now={new Date()} />
      <JobList initialRows={first.rows} initialCursor={first.nextCursor} />
    </main>
  )
}

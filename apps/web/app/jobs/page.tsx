import { isExpired } from '@job-finder/graph'
import { getStore } from '@/lib/store'
import { PAGE_SIZE } from './constants'
import { JobList } from './_components/job-list'
import { StatusStrip } from '../_components/status-strip'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const store = getStore()
  // "알림 대기"는 notify가 실제로 고를 대상을 세야 한다 — 그래서 notify 후보와 같은
  // 대상(status ok · 미발송 · hidden 제외)을 주는 listNotifyPending을 쓰고, 남은 두
  // 조건만 selectForDigest와 똑같이 여기서 적용한다(topN은 안 자른다 — 대기 총량이라).
  // 예전엔 listDashboardJobs를 필터 조합으로 흉내 냈는데, hidden 제외가 빠져 있어
  // 따로 걸러야 했고 무엇보다 profile을 기다렸다가 나가는 순차 질의였다. 함수는
  // icn1, DB는 서울이라 한 왕복이 곧 지연이므로 한 웨이브로 모은다.
  const [stats, first, profile, pending] = await Promise.all([
    store.getDashboardStats(),
    store.listDashboardJobs({ limit: PAGE_SIZE }),
    store.getProfile(),
    store.listNotifyPending(),
  ])
  const now = new Date()
  const pendingCount = pending.filter(
    (p) => p.total >= profile.notifyRule.minScore && !isExpired(p.dueTime, now),
  ).length

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      {/* TopBar가 이미 "Job Finder" 브랜드를 보여준다 — 여기서는 페이지 고유의 제목만 둔다. */}
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">채점된 공고</h1>
        <p className="text-neutral-600">점수 순으로 정렬돼 있다. 최소 점수·북마크·발송 여부로 좁혀볼 수 있다.</p>
      </header>
      <StatusStrip
        stats={stats}
        pendingNotify={{ count: pendingCount, topN: profile.notifyRule.topN }}
        now={now}
      />
      <JobList initialRows={first.rows} initialCursor={first.nextCursor} />
    </main>
  )
}

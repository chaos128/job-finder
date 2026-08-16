import type { DashboardStats } from '@job-finder/db'
import { formatRelativeTime, isScoringStale } from '@/lib/dashboard'

function Card({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${warn ? 'border-amber-400 bg-amber-50' : 'border-neutral-200 bg-white'}`}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${warn ? 'text-amber-900' : ''}`}>{value}</div>
    </div>
  )
}

/** pendingNotify는 랜딩에서 생략한다 — 그 값을 위해 추가 질의를 하지 않는다. */
export function StatusStrip({ stats, pendingNotify, now }: {
  stats: DashboardStats; pendingNotify?: number; now: Date
}) {
  const versions = Object.entries(stats.rubricVersions)
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="채점 진행" value={`${stats.scoredJobs} / ${stats.totalJobs}`} />
        <Card
          label="마지막 채점"
          value={formatRelativeTime(stats.lastScoredAt, now)}
          warn={isScoringStale(stats.lastScoredAt, now)}
        />
        {pendingNotify !== undefined && <Card label="알림 대기" value={`${pendingNotify}건`} />}
        <Card
          label="루브릭"
          value={versions.map(([v, n]) => `${v}: ${n}`).join(' · ') || '없음'}
          // 여러 버전이 섞이면 서로 다른 기준으로 매긴 점수가 같은 순위 경쟁을 한다.
          warn={versions.length > 1}
        />
      </div>
      <div className="text-xs text-neutral-500">
        최근 실행:{' '}
        {stats.recentRuns.length === 0 ? '없음' : stats.recentRuns.map((r) => (
          <span key={r.id} className="mr-3">
            {r.pipeline ?? '알 수 없음'} {formatRelativeTime(r.startedAt, now)}
            {r.endedAt ? '' : ' (미완료)'}
          </span>
        ))}
      </div>
    </section>
  )
}

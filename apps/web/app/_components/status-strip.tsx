import type { DashboardStats } from '@job-finder/db'
import { Badge } from '@job-finder/ui'
import { formatRelativeTime, isScoringStale } from '@/lib/dashboard'

function Tile({ label, value, caption, warn, warnLabel }: {
  label: string; value: string; caption: string; warn?: boolean; warnLabel?: string
}) {
  return (
    // 배지만으로는 라벨을 직접 봐야 눈에 띈다 — 링을 더해 줄 전체를 훑을 때도
    // 경고 타일이 나머지 셋과 다르다는 게 주변 시야에서 걸리게 한다.
    <div
      className={`rounded-xl border bg-white p-5 shadow-sm ${
        warn ? 'border-amber-300 ring-1 ring-amber-300' : 'border-neutral-200'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-500">{label}</span>
        {/* 경고는 카드를 물들이는 대신 배지로 — 은은한 카드보다 또렷한 배지가 눈에 띈다. */}
        {warn && <Badge variant="warn">{warnLabel}</Badge>}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-neutral-400">{caption}</div>
    </div>
  )
}

/** pendingNotify는 랜딩에서 생략한다 — 그 값을 위해 추가 질의를 하지 않는다. */
export function StatusStrip({ stats, pendingNotify, now }: {
  stats: DashboardStats; pendingNotify?: number; now: Date
}) {
  const versions = Object.entries(stats.rubricVersions)
  const stale = isScoringStale(stats.lastScoredAt, now)
  const mixedRubric = versions.length > 1

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="채점 진행"
          value={`${stats.scoredJobs} / ${stats.totalJobs}`}
          caption="전체 공고 대비"
        />
        <Tile
          label="마지막 채점"
          value={formatRelativeTime(stats.lastScoredAt, now)}
          caption="가장 최근 채점 시각"
          warn={stale}
          warnLabel="지연"
        />
        {pendingNotify !== undefined && (
          <Tile label="알림 대기" value={`${pendingNotify}건`} caption="발송 예정 공고 수" />
        )}
        <Tile
          label="루브릭"
          value={versions.map(([v, n]) => `${v}: ${n}`).join(' · ') || '없음'}
          caption="적용 중인 채점 기준 버전"
          // 여러 버전이 섞이면 서로 다른 기준으로 매긴 점수가 같은 순위 경쟁을 한다.
          warn={mixedRubric}
          warnLabel="혼재"
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

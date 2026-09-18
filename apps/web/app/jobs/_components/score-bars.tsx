import { axisPercent } from '@/lib/dashboard'
import { cn } from '@job-finder/ui'
import { AXIS_BAR_COLOR, AXIS_LABEL } from './score-visuals'

const AXES = ['stack', 'role', 'domain', 'growth', 'conditions'] as const

export function ScoreBars({ breakdown }: { breakdown: Record<string, number> }) {
  return (
    <dl className="space-y-2">
      {AXES.map((key) => {
        const v = breakdown[key] ?? 0
        return (
          <div key={key} className="flex items-center gap-3">
            <dt className="w-24 shrink-0 text-sm text-neutral-600">{AXIS_LABEL[key]}</dt>
            <dd className="flex flex-1 items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200">
                {/* overflow-hidden: 점수가 20을 넘어도(방어적 상한 없음) 막대가 트랙을 넘지 않는다.
                    색은 카드 세그먼트 바·Badge variant와 같은 축 매핑(score-visuals.ts)을 쓴다. */}
                <div className={cn('h-2 rounded-full', AXIS_BAR_COLOR[key])} style={{ width: `${axisPercent(v)}%` }} />
              </div>
              <span className="w-6 text-right text-sm tabular-nums">{v}</span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

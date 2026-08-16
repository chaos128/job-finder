'use client'

import { Badge, Button, cn } from '@job-finder/ui'
import type { DashboardRow } from '@job-finder/db'
import Link from 'next/link'
import { AXIS_BAR_COLOR, scoreBandClass } from './score-visuals'

const AXES = ['stack', 'role', 'domain', 'growth', 'conditions'] as const

export function JobCard({ row, onToggleBookmark, onToggleHidden }: {
  row: DashboardRow
  onToggleBookmark: (jobId: string, next: boolean) => void
  onToggleHidden: (jobId: string, next: boolean) => void
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm',
        // 제외된 카드는 비활성처럼 보이게: 회색 배경 + 텍스트 흐림 + 클릭 대상이
        // 아님을 알리는 opacity. 실제로 pointer-events를 막지는 않는다 — 되돌리기
        // 버튼(과 상세 링크)은 계속 눌러야 하기 때문이다.
        row.hidden && 'bg-neutral-100 opacity-60 grayscale',
      )}
    >
      <div className={cn('w-14 shrink-0 text-3xl font-bold tabular-nums', scoreBandClass(row.total))}>
        {row.total}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <Link href={`/jobs/${row.jobId}`} className="block hover:underline">
          {/* 회사명을 muted 캡션으로 두면 목록을 훑을 때 안 읽힌다 — 어느 회사인지가
              포지션만큼 중요한 판단 재료라 굵기와 크기를 올렸다. */}
          <div className="text-base font-semibold text-neutral-800">{row.companyName}</div>
          {/* truncate를 쓰지 않는다. 포지션 제목에 괄호로 도메인이 붙는 경우가 많은데
              (예: "Frontend Engineer (MLOps, Vision AI Platform)") 잘리면 그 부분이
              통째로 사라져 무슨 일인지 알 수 없다. 줄바꿈시킨다. */}
          <div className="text-lg font-medium">{row.position}</div>
        </Link>
        {/* 축별 구성 세그먼트 바 — 숫자를 읽기 전에 매치의 모양이 먼저 보이게 한다.
            트랙 100%가 만점 100점이라 채워진 길이 자체가 총점이고, 색 구간이 축 배분이다. */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100">
          {AXES.map((a) => {
            const v = row.breakdown[a] ?? 0
            return (
              <div
                key={a}
                className={cn('h-full shrink-0', AXIS_BAR_COLOR[a])}
                // 0점 축은 폭 0(기여가 없다는 뜻을 그대로 보여준다). 그 외에는 비율이
                // 아무리 작아도 최소 8px(막대 높이와 같음)을 보장해 다섯 구간이 항상
                // 보이게 한다 — 실측(총점 17, 배분 1/1/3/10/2, 677px 트랙)에서 stack·role이
                // 6.8px로 뭉개져 안 보였다. 중앙값(53점) 기준 카드 절반가량이 이 문제를
                // 겪는다. 트레이드오프: 저점수 축에서는 실제 비율보다 살짝 부풀어 보인다.
                style={{ width: v > 0 ? `max(${v}%, 8px)` : '0px' }}
              />
            )
          })}
        </div>
        {/* line-clamp-6: 실측(168건) summary 길이가 170~313자로 좁게 몰려 있어(p95 277,
            최댓값 313) 6줄이면 사실상 전부 잘리지 않는다. 그래도 상한은 남긴다 — 이례적으로
            긴 값이 들어와도 카드 하나가 목록 리듬을 무너뜨릴 만큼 길어지지 않게. */}
        <p className="line-clamp-6 text-sm text-neutral-600">{row.summary}</p>
        <div className="flex flex-wrap gap-1.5">
          {AXES.map((a) => (
            <Badge key={a} variant={a}>
              {a} {row.breakdown[a] ?? 0}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span>{row.dueTime ? `마감 ${row.dueTime}` : '상시채용'}</span>
          {row.notifiedAt && <Badge>발송됨</Badge>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center">
        <Button
          type="button"
          variant="ghost"
          aria-label={row.bookmarked ? '북마크 해제' : '북마크'}
          onClick={() => onToggleBookmark(row.jobId, !row.bookmarked)}
          className="h-auto px-2 text-2xl leading-none"
        >
          {row.bookmarked ? '★' : '☆'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label={row.hidden ? '제외 해제' : '제외'}
          aria-pressed={row.hidden}
          onClick={() => onToggleHidden(row.jobId, !row.hidden)}
          className={cn('h-auto px-2 text-lg leading-none', row.hidden && 'text-neutral-900')}
        >
          {row.hidden ? '↺' : '✕'}
        </Button>
      </div>
    </div>
  )
}

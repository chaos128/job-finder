'use client'

import { Badge, Button } from '@job-finder/ui'
import type { DashboardRow } from '@job-finder/db'
import Link from 'next/link'

const AXES = ['stack', 'role', 'domain', 'growth', 'conditions'] as const

export function JobCard({ row, onToggleBookmark }: {
  row: DashboardRow
  onToggleBookmark: (jobId: string, next: boolean) => void
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="w-14 shrink-0 text-3xl font-bold tabular-nums">{row.total}</div>
      <div className="min-w-0 flex-1 space-y-2">
        <Link href={`/jobs/${row.jobId}`} className="block hover:underline">
          <div className="text-sm text-neutral-500">{row.companyName}</div>
          <div className="truncate text-lg font-medium">{row.position}</div>
        </Link>
        <p className="line-clamp-2 text-sm text-neutral-600">{row.summary}</p>
        <div className="flex flex-wrap gap-1.5">
          {AXES.map((a) => (
            <Badge key={a}>
              {a} {row.breakdown[a] ?? 0}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span>{row.dueTime ? `마감 ${row.dueTime}` : '상시채용'}</span>
          {row.notifiedAt && <Badge>발송됨</Badge>}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        aria-label={row.bookmarked ? '북마크 해제' : '북마크'}
        onClick={() => onToggleBookmark(row.jobId, !row.bookmarked)}
        className="h-auto shrink-0 px-2 text-2xl leading-none"
      >
        {row.bookmarked ? '★' : '☆'}
      </Button>
    </div>
  )
}

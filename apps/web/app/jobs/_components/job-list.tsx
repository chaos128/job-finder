'use client'

import type { DashboardCursor, DashboardFilters, DashboardRow } from '@job-finder/db'
import { Badge, Button, Input } from '@job-finder/ui'
import { useEffect, useRef, useState, useTransition } from 'react'
import { loadMoreJobs, toggleBookmark } from '../actions'
import { JobCard } from './job-card'

export function JobList({ initialRows, initialCursor }: {
  initialRows: DashboardRow[]; initialCursor: DashboardCursor | null
}) {
  const [filters, setFilters] = useState<DashboardFilters>({})
  const [rows, setRows] = useState(initialRows)
  const [cursor, setCursor] = useState(initialCursor)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const sentinel = useRef<HTMLDivElement>(null)

  // 필터가 바뀌면 서버에서 처음부터 다시 받는다 — 커서 페이징이라 클라이언트에서 좁힐 수 없다.
  useEffect(() => {
    let cancelled = false
    startTransition(async () => {
      try {
        const page = await loadMoreJobs(filters)
        if (!cancelled) { setRows(page.rows); setCursor(page.nextCursor); setError(null) }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })
    return () => { cancelled = true }
  }, [filters])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !cursor || pending) return
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      startTransition(async () => {
        try {
          const page = await loadMoreJobs(filters, cursor)
          setRows((prev) => [...prev, ...page.rows])
          setCursor(page.nextCursor)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
      })
    })
    io.observe(el)
    return () => io.disconnect()
  }, [cursor, filters, pending])

  function onToggleBookmark(jobId: string, next: boolean) {
    setRows((prev) => prev.map((r) => (r.jobId === jobId ? { ...r, bookmarked: next } : r)))
    startTransition(async () => {
      try {
        await toggleBookmark(jobId, next)
      } catch (e) {
        // 실패를 삼키면 저장된 줄 안다. 되돌리고 알린다.
        setRows((prev) => prev.map((r) => (r.jobId === jobId ? { ...r, bookmarked: !next } : r)))
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          최소 점수
          <Input
            type="number" min={0} max={100} step={5}
            className="w-20"
            value={filters.minScore ?? ''}
            onChange={(e) => setFilters((f) => ({
              ...f, minScore: e.target.value === '' ? undefined : Number(e.target.value),
            }))}
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!filters.bookmarkedOnly}
            onChange={(e) => setFilters((f) => ({ ...f, bookmarkedOnly: e.target.checked }))} />
          북마크만
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!filters.unnotifiedOnly}
            onChange={(e) => setFilters((f) => ({ ...f, unnotifiedOnly: e.target.checked }))} />
          미발송만
        </label>
        <Badge>{rows.length}건</Badge>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
          <Button
            type="button" variant="outline" size="sm" className="ml-3"
            onClick={() => setFilters((f) => ({ ...f }))}
          >
            다시 시도
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => (
          <JobCard key={row.jobId} row={row} onToggleBookmark={onToggleBookmark} />
        ))}
      </div>

      <div ref={sentinel} className="h-8 text-center text-sm text-neutral-400">
        {pending ? '불러오는 중…' : cursor ? '' : '끝'}
      </div>
    </section>
  )
}

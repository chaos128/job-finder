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

  // 필터가 바뀔 때마다 늘어나는 세대 번호. cancelled 플래그 하나로는 필터→필터
  // 경쟁만 막힌다 — 스크롤 응답이 필터 교체 "이후"에 도착하는 역방향 경쟁은 못
  // 막는다(io.disconnect()는 이미 시작된 startTransition 본문을 취소하지 못한다).
  // 두 effect가 응답을 적용하기 전에 자기가 시작될 때의 세대와 지금 세대를 대조해,
  // 어느 쪽이 먼저 끝나든 최신 필터가 아닌 응답은 버린다.
  const generation = useRef(0)
  // 첫 마운트는 서버 컴포넌트가 이미 기본 필터(빈 필터)로 첫 페이지를 받아왔으므로
  // 건너뛴다 — 안 그러면 페이지뷰마다 같은 조회가 중복으로 나간다.
  const isFirstRun = useRef(true)

  // 필터가 바뀌면 서버에서 처음부터 다시 받는다 — 커서 페이징이라 클라이언트에서 좁힐 수 없다.
  useEffect(() => {
    if (isFirstRun.current) { isFirstRun.current = false; return }
    const myGeneration = ++generation.current
    startTransition(async () => {
      try {
        const page = await loadMoreJobs(filters)
        if (myGeneration === generation.current) {
          setRows(page.rows); setCursor(page.nextCursor); setError(null)
        }
      } catch (e) {
        if (myGeneration === generation.current) setError(e instanceof Error ? e.message : String(e))
      }
    })
  }, [filters])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !cursor || pending) return
    const myGeneration = generation.current
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      startTransition(async () => {
        try {
          const page = await loadMoreJobs(filters, cursor)
          if (myGeneration === generation.current) {
            setRows((prev) => [...prev, ...page.rows])
            setCursor(page.nextCursor)
          }
        } catch (e) {
          if (myGeneration === generation.current) setError(e instanceof Error ? e.message : String(e))
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

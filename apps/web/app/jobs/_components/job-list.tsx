'use client'

import type { DashboardCursor, DashboardFilters, DashboardRow } from '@job-finder/db'
// 정렬 규칙은 서버(스토어)와 반드시 같아야 한다. 배럴('@job-finder/db')을 값으로
// import하면 supabase-store가 브라우저 번들에 딸려 오므로, 의존성 없는 서브패스로
// 그 함수 하나만 가져온다 — 복제해두면 어긋나는 순간 페이징이 깨진다.
import { compareDashboardOrder } from '@job-finder/db/dashboard-order'
import { Badge, Button, cn, Input } from '@job-finder/ui'
import { useEffect, useRef, useState, useTransition } from 'react'
import { loadMoreJobs, toggleBookmark, toggleHidden } from '../actions'
import { JobCard } from './job-card'
import { UnscoredList } from './unscored-list'

/**
 * 다음 페이지를 이어붙인다. 단순 concat이 아니라 jobId로 합치고 다시 정렬하는
 * 이유: hidden은 정렬 키라서, 이미 받아온 공고를 제외하면 그 공고가 뒤쪽
 * (hidden 구간)으로 이동해 아직 안 받은 페이지 범위 안으로 들어간다. 그러면
 * 서버가 같은 행을 한 번 더 내려주고 concat은 그대로 중복 렌더한다(운영 168건 ·
 * PAGE_SIZE 100에서 재현: 카드 하나 제외 후 스크롤하면 rows 169 / unique 168,
 * 같은 jobId가 두 자리에 뜨고 key가 충돌한다). 제외 해제도 같은 이유로 겹친다.
 */
function mergeRows(prev: DashboardRow[], next: DashboardRow[]): DashboardRow[] {
  const seen = new Set(prev.map((r) => r.jobId))
  return [...prev, ...next.filter((r) => !seen.has(r.jobId))].sort(compareDashboardOrder)
}

export function JobList({ initialRows, initialCursor }: {
  initialRows: DashboardRow[]; initialCursor: DashboardCursor | null
}) {
  const [filters, setFilters] = useState<DashboardFilters>({})
  const [rows, setRows] = useState(initialRows)
  const [cursor, setCursor] = useState(initialCursor)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const sentinel = useRef<HTMLDivElement>(null)
  // 점수 목록의 질의(필터·커서·무한스크롤)와는 완전히 무관하다 — 켜지면 점수 목록
  // 대신 미채점 구간만 보여준다. 점수 목록의 상태는 그대로 남아 있어서 끄면 재조회 없이
  // 돌아온다.
  const [unscoredOnly, setUnscoredOnly] = useState(false)

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
    // 응답을 기다렸다 채우지 않고, 요청을 보내기 전에 이전 필터의 페이징 상태를
    // 먼저 버린다. generation 가드는 "어느 응답이 이긴다"만 정하므로, 이 요청이
    // 실패하면 cursor가 이전 필터 결과의 마지막 행을 가리킨 채 남는다 — 그 뒤의
    // 스크롤은 같은 세대라 가드를 통과하고, 새 필터로 낡은 커서를 태워 두 질의의
    // 결과를 한 목록에 이어붙인다(새로고침 전까지 자가 교정되지 않는다).
    setRows([]); setCursor(null)
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
            setRows((prev) => mergeRows(prev, page.rows))
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

  // 북마크와 같은 규약: 낙관적으로 먼저 반영, 실패하면 되돌리고 알린다. 다른 점은
  // hidden이 정렬 키라는 것 — 값만 바꾸면 서버가 주는 순서(맨 뒤)와 어긋나므로
  // 매번 compareDashboardOrder로 다시 정렬해야 "새로고침 전까지도" 위치가 맞는다.
  function onToggleHidden(jobId: string, next: boolean) {
    setRows((prev) => prev
      .map((r) => (r.jobId === jobId ? { ...r, hidden: next } : r))
      .sort(compareDashboardOrder))
    startTransition(async () => {
      try {
        await toggleHidden(jobId, next)
      } catch (e) {
        setRows((prev) => prev
          .map((r) => (r.jobId === jobId ? { ...r, hidden: !next } : r))
          .sort(compareDashboardOrder))
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {/* 최소 점수·북마크·미발송은 전부 점수가 있어야 뜻이 생기는 조건이라, 미채점만
            볼 때는 숨긴다. 남겨두면 눌러도 아무 일이 없어 고장으로 읽힌다. */}
        {!unscoredOnly && (<>
        <label className="flex items-center gap-2 text-neutral-600">
          최소 점수
          <Input
            type="number" min={0} max={100} step={5}
            className="h-9 w-20 rounded-full text-center"
            value={filters.minScore ?? ''}
            onChange={(e) => setFilters((f) => ({
              ...f, minScore: e.target.value === '' ? undefined : Number(e.target.value),
            }))}
          />
        </label>
        <button
          type="button"
          aria-pressed={!!filters.bookmarkedOnly}
          onClick={() => setFilters((f) => ({ ...f, bookmarkedOnly: !f.bookmarkedOnly }))}
          className={cn(
            'h-9 rounded-full border px-4 font-medium transition-colors',
            filters.bookmarkedOnly
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100',
          )}
        >
          북마크만
        </button>
        <button
          type="button"
          aria-pressed={!!filters.unnotifiedOnly}
          onClick={() => setFilters((f) => ({ ...f, unnotifiedOnly: !f.unnotifiedOnly }))}
          className={cn(
            'h-9 rounded-full border px-4 font-medium transition-colors',
            filters.unnotifiedOnly
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100',
          )}
        >
          미발송만
        </button>
        </>)}
        <button
          type="button"
          aria-pressed={unscoredOnly}
          onClick={() => setUnscoredOnly((v) => !v)}
          className={cn(
            'h-9 rounded-full border px-4 font-medium transition-colors',
            unscoredOnly
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100',
          )}
        >
          미채점만
        </button>
        {!unscoredOnly && <Badge className="ml-auto">{rows.length}건</Badge>}
      </div>

      {/* 에러 배너·목록·센티넬은 전부 점수 목록에 속한다. 미채점만 볼 때 같이 띄우면
          어느 목록의 상태인지 알 수 없다 — UnscoredList가 자기 에러를 따로 보여준다. */}
      {unscoredOnly ? (
        <UnscoredList />
      ) : (
        <>
          {error && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
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
              <JobCard
                key={row.jobId} row={row}
                onToggleBookmark={onToggleBookmark} onToggleHidden={onToggleHidden}
              />
            ))}
          </div>

          <div ref={sentinel} className="h-8 text-center text-sm text-neutral-400">
            {pending ? '불러오는 중…' : cursor ? '' : '끝'}
          </div>
        </>
      )}
    </section>
  )
}

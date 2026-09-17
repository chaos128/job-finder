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
import { saveListCache, takeListCache } from './list-cache'
import { DuplicateList } from './duplicate-list'
import { UnscoredList } from './unscored-list'

/**
 * 다음 페이지를 이어붙인다. 단순 concat이 아니라 jobId로 합치는 이유: 같은 행이
 * 두 번 내려오면 concat은 그대로 중복 렌더하고 key가 충돌한다(운영 168건 ·
 * PAGE_SIZE 100에서 실제로 재현했다 — rows 169 / unique 168).
 *
 * 목록이 제외 여부로 갈린 뒤로는 토글 때문에 생기던 중복은 사라졌지만(제외하면 이
 * 목록에서 빠질 뿐 뒤쪽으로 이동하지 않는다), 북마크·재채점으로 순서가 밀리는
 * 경계에서는 여전히 겹칠 수 있어 그대로 둔다. 정렬도 유지한다 — 서버가 주는
 * 순서와 같은 규칙이라 이어붙인 뒤에도 어긋나지 않는다.
 */
function mergeRows(prev: DashboardRow[], next: DashboardRow[]): DashboardRow[] {
  const seen = new Set(prev.map((r) => r.jobId))
  return [...prev, ...next.filter((r) => !seen.has(r.jobId))].sort(compareDashboardOrder)
}

/**
 * 검색어를 필터에 반영하기까지 기다리는 시간. 필터가 바뀌면 서버에서 처음부터 다시
 * 받으므로(아래 effect), 한 글자마다 걸면 "프론트엔드" 한 단어에 왕복이 여섯 번 난다.
 */
const SEARCH_DEBOUNCE_MS = 300

export function JobList({ initialRows, initialCursor, initialTotal }: {
  initialRows: DashboardRow[]; initialCursor: DashboardCursor | null
  initialTotal: number | null
}) {
  // 상세에 다녀온 것이면 떠날 때 담아둔 목록을 그대로 되살린다. 첫 렌더에 이미
  // 전량이 들어 있어야 문서 높이가 유지되고, 그래야 브라우저의 스크롤 복원이
  // 제자리를 찾는다 — 마운트 후에 채우면 이미 짧아진 높이로 잘린 뒤다.
  const [restored] = useState(takeListCache)
  const [filters, setFilters] = useState<DashboardFilters>(() => restored?.filters ?? {})
  const [rows, setRows] = useState(() => restored?.rows ?? initialRows)
  const [cursor, setCursor] = useState(() => restored?.cursor ?? initialCursor)
  // 무한 스크롤이라 rows.length는 "지금까지 불러온 만큼"일 뿐이다. 필터에 걸린
  // 전체 건수는 서버만 알고, 커서 페이지 응답에서는 null로 오므로 따로 들고 있는다.
  const [total, setTotal] = useState(() => restored?.total ?? initialTotal)
  // 입력칸은 즉시 반응해야 하고 질의는 디바운스돼야 해서 상태를 둘로 나눈다.
  const [searchInput, setSearchInput] = useState(() => restored?.searchInput ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const sentinel = useRef<HTMLDivElement>(null)
  // 점수 목록의 질의(필터·커서·무한스크롤)와는 완전히 무관하다 — 켜지면 점수 목록
  // 대신 미채점 구간만 보여준다. 점수 목록의 상태는 그대로 남아 있어서 끄면 재조회 없이
  // 돌아온다.
  const [unscoredOnly, setUnscoredOnly] = useState(false)
  // 중복도 같은 성질의 별도 구간이다(점수가 없어 점수 목록으로는 낼 수 없다).
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)

  // 필터가 바뀔 때마다 늘어나는 세대 번호. cancelled 플래그 하나로는 필터→필터
  // 경쟁만 막힌다 — 스크롤 응답이 필터 교체 "이후"에 도착하는 역방향 경쟁은 못
  // 막는다(io.disconnect()는 이미 시작된 startTransition 본문을 취소하지 못한다).
  // 두 effect가 응답을 적용하기 전에 자기가 시작될 때의 세대와 지금 세대를 대조해,
  // 어느 쪽이 먼저 끝나든 최신 필터가 아닌 응답은 버린다.
  const generation = useRef(0)
  // 첫 마운트는 서버 컴포넌트가 이미 기본 필터(빈 필터)로 첫 페이지를 받아왔으므로
  // 건너뛴다 — 안 그러면 페이지뷰마다 같은 조회가 중복으로 나간다.
  const isFirstRun = useRef(true)

  // 언마운트 시점에 최신 값을 담아야 하는데, effect의 cleanup은 그 effect가
  // 만들어질 때의 값을 붙든다. ref로 최신값을 따라가게 해 둔다.
  const snapshot = useRef({ rows, cursor, filters, total, searchInput })
  snapshot.current = { rows, cursor, filters, total, searchInput }

  // 상세로 떠날 때만 실제로 담긴다(markDetailNavigation 참고).
  useEffect(() => () => saveListCache(snapshot.current), [])

  // 타이핑이 멎은 뒤에야 필터로 넘긴다. filters가 바뀌면 아래 effect가 전량을 다시
  // 받으므로, 디바운스 없이 이으면 글자마다 목록이 비워졌다 채워진다.
  // 값이 같으면 setFilters를 부르지 않는다 — 같은 객체라도 새로 만들면 아래 effect가
  // 의존성 변화로 보고 재조회한다(되살린 목록이 첫 렌더에 날아간다).
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => (f.search ?? '') === searchInput ? f : { ...f, search: searchInput })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [searchInput])

  // 필터가 바뀌면 서버에서 처음부터 다시 받는다 — 커서 페이징이라 클라이언트에서 좁힐 수 없다.
  useEffect(() => {
    if (isFirstRun.current) { isFirstRun.current = false; return }
    const myGeneration = ++generation.current
    // 응답을 기다렸다 채우지 않고, 요청을 보내기 전에 이전 필터의 페이징 상태를
    // 먼저 버린다. generation 가드는 "어느 응답이 이긴다"만 정하므로, 이 요청이
    // 실패하면 cursor가 이전 필터 결과의 마지막 행을 가리킨 채 남는다 — 그 뒤의
    // 스크롤은 같은 세대라 가드를 통과하고, 새 필터로 낡은 커서를 태워 두 질의의
    // 결과를 한 목록에 이어붙인다(새로고침 전까지 자가 교정되지 않는다).
    setRows([]); setCursor(null); setTotal(null)
    startTransition(async () => {
      try {
        const page = await loadMoreJobs(filters)
        if (myGeneration === generation.current) {
          setRows(page.rows); setCursor(page.nextCursor); setTotal(page.total); setError(null)
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
    }, {
      // 바닥에 닿은 뒤에 부르면 "불러오는 중…"을 매번 마주친다. 뷰포트를 아래로
      // 1200px 늘린 것처럼 취급해, 센티넬이 아직 안 보일 때 미리 당겨온다.
      //
      // 1200인 이유: 카드가 ~250px라 다섯 장 앞서 발동하고, 빠른 스크롤(초당
      // 2000~3000px)에서 0.4~0.6초의 여유가 된다 — /jobs 첫 응답이 356ms였으니
      // 한 페이지 fetch가 그 안에 들어온다.
      //
      // 한 페이지(20장 ≈ 5000px)보다 작게 잡는 것이 중요하다. 이 값이 페이지
      // 높이를 넘으면 한 번 받은 직후에도 센티넬이 사거리 안에 남아 다음 페이지를
      // 연달아 부르고, 스크롤하지 않은 사용자에게 목록 전체가 로드된다.
      rootMargin: '1200px 0px',
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

  // 북마크와 같은 규약: 낙관적으로 먼저 반영, 실패하면 되돌리고 알린다.
  // 토글한 카드를 목록에서 빼지 않고 회색으로만 바꿔 제자리에 둔다 — 이제 이 목록에
  // 속하지 않는 행이지만, 즉시 사라지면 잘못 눌렀을 때 되돌릴 방법이 없다.
  // 다음 조회(필터 변경·새로고침)에서 자연히 빠진다.
  function onToggleHidden(jobId: string, next: boolean) {
    setRows((prev) => prev.map((r) => (r.jobId === jobId ? { ...r, hidden: next } : r)))
    startTransition(async () => {
      try {
        await toggleHidden(jobId, next)
      } catch (e) {
        setRows((prev) => prev.map((r) => (r.jobId === jobId ? { ...r, hidden: !next } : r)))
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {/* 회사명·포지션 부분 일치. 다른 필터와 같은 이유로 미채점만일 때는 막는다.
            서버에서 거른다 — 커서 페이징이라 화면에 올라온 행은 전체의 일부일 뿐이고,
            여기서 좁히면 남은 페이지를 어디서 이어야 할지 알 수 없다. */}
        <Input
          type="search"
          disabled={unscoredOnly}
          placeholder="회사·포지션 검색"
          aria-label="회사명 또는 포지션 검색"
          className={cn(
            'h-9 w-56 rounded-full px-4 disabled:cursor-not-allowed disabled:opacity-40',
          )}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {/* 최소 점수·북마크·미발송은 전부 점수가 있어야 뜻이 생기는 조건이라, 미채점만
            볼 때는 못 누르게 막는다. 숨기지는 않는다 — 토글할 때마다 줄 폭이 통째로
            바뀌어 아래 목록이 밀린다(CLS). 자리를 지키면서 비활성만 알린다. */}
        <label className={cn('flex items-center gap-2 text-neutral-600', unscoredOnly && 'opacity-40')}>
          최소 점수
          <Input
            type="number" min={0} max={100} step={5}
            disabled={unscoredOnly}
            className="h-9 w-20 rounded-full text-center disabled:cursor-not-allowed"
            value={filters.minScore ?? ''}
            onChange={(e) => setFilters((f) => ({
              ...f, minScore: e.target.value === '' ? undefined : Number(e.target.value),
            }))}
          />
        </label>
        <button
          type="button"
          disabled={unscoredOnly}
          aria-pressed={!!filters.bookmarkedOnly}
          onClick={() => setFilters((f) => ({ ...f, bookmarkedOnly: !f.bookmarkedOnly }))}
          className={cn(
            'h-9 rounded-full border px-4 font-medium transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-40',
            filters.bookmarkedOnly
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 disabled:hover:bg-white',
          )}
        >
          북마크만
        </button>
        <button
          type="button"
          disabled={unscoredOnly}
          aria-pressed={!!filters.unnotifiedOnly}
          onClick={() => setFilters((f) => ({ ...f, unnotifiedOnly: !f.unnotifiedOnly }))}
          className={cn(
            'h-9 rounded-full border px-4 font-medium transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-40',
            filters.unnotifiedOnly
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 disabled:hover:bg-white',
          )}
        >
          미발송만
        </button>
        {/* 기본 목록에는 제외된 공고가 아예 안 나온다. 이 토글이 그것들을 다시 볼
            유일한 통로다 — 50점 이하 자동 제외가 있어서 꽤 많이 쌓인다. */}
        <button
          type="button"
          disabled={unscoredOnly}
          aria-pressed={!!filters.hiddenOnly}
          onClick={() => setFilters((f) => ({ ...f, hiddenOnly: !f.hiddenOnly }))}
          className={cn(
            'h-9 rounded-full border px-4 font-medium transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-40',
            filters.hiddenOnly
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 disabled:hover:bg-white',
          )}
        >
          제외만
        </button>
        {/* 중복은 점수 목록의 필터가 아니라 별도 뷰다 — 그 목록은 scores에서
            출발하는데 중복은 채점 큐에서 빠져 점수 행이 영영 안 생긴다. 필터로
            두었더니 언제나 빈 화면이었다. 미채점 토글과 같은 방식으로 가른다. */}
        <button
          type="button"
          disabled={unscoredOnly}
          aria-pressed={duplicatesOnly}
          onClick={() => setDuplicatesOnly((v) => !v)}
          className={cn(
            'h-9 rounded-full border px-4 font-medium transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-40',
            duplicatesOnly
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 disabled:hover:bg-white',
          )}
        >
          중복
        </button>
        <button
          type="button"
          disabled={duplicatesOnly}
          aria-pressed={unscoredOnly}
          onClick={() => setUnscoredOnly((v) => !v)}
          className={cn(
            'h-9 rounded-full border px-4 font-medium transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-40',
            unscoredOnly
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100',
          )}
        >
          미채점만
        </button>
        {/* 서버가 센 전체 건수다. rows.length는 무한 스크롤로 지금까지 불러온 만큼일
            뿐이라, 그 값을 "건수"로 보여주면 스크롤할 때마다 총량이 늘어나는 것처럼
            보인다. 아직 못 받았으면(첫 조회 중) 숫자 자리를 비워 둔다 — 0건으로
            채우면 "결과 없음"으로 잘못 읽힌다. */}
        {!unscoredOnly && !duplicatesOnly && (
          <Badge className="ml-auto">{total === null ? '…' : `${total}건`}</Badge>
        )}
      </div>

      {/* 에러 배너·목록·센티넬은 전부 점수 목록에 속한다. 미채점만 볼 때 같이 띄우면
          어느 목록의 상태인지 알 수 없다 — UnscoredList가 자기 에러를 따로 보여준다. */}
      {unscoredOnly ? (
        <UnscoredList />
      ) : duplicatesOnly ? (
        <DuplicateList />
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

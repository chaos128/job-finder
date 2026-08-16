# 대시보드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채점 상태와 채점된 공고를 브라우저에서 조회하는 읽기 전용 대시보드를 만든다.

**Architecture:** Next.js App Router 서버 컴포넌트가 `getStore()`로 직접 조회하고, 상호작용(필터·무한스크롤·북마크)만 클라이언트 컴포넌트가 맡는다. 새 JSON API 라우트를 만들지 않고 Server Action을 쓴다 — 페이지가 공개이므로 service role 키가 브라우저로 내려가지 않는 경계가 유일한 방어선이다.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, Supabase(PostgREST), vitest

**Spec:** [docs/superpowers/specs/2026-08-16-dashboard-design.md](../specs/2026-08-16-dashboard-design.md)

## Global Constraints

- 테스트는 **루트에서 `pnpm test`**. 워크스페이스에는 `test` 스크립트가 없어 `pnpm -r test`는 아무것도 실행하지 않고 조용히 성공한다. 착수 시점 기준 112개 통과.
- **`SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_KEY`를 절대 설정하지 마라.** 운영 DB(실공고 168건 + 소유자 프로필)를 truncate한다.
- **적용된 마이그레이션 파일(`0001`, `0002`)을 수정하지 마라.** 새 파일을 만들고 `if not exists`로 멱등하게 쓴다.
- `Store` 인터페이스를 바꾸면 `packages/db/src/store.ts`, `memory-store.ts`, `supabase-store.ts`, `test/store-contract.ts` **네 파일이 함께** 움직인다.
- 노드는 throw하지 않는다(`NodeResult` 반환). 이 계획은 노드를 추가하지 않는다.
- 주석은 한국어로, **"왜"를 적는다**. 무엇을 하는지는 코드가 말한다.
- 워크스페이스 상대 import는 `.js` 확장자로 `.ts`를 가리킨다. 기존 방식을 그대로 따른다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## 파일 구조

**생성**

| 경로 | 책임 |
| --- | --- |
| `packages/db/migrations/0003_runs_pipeline.sql` | `runs.pipeline` 컬럼 |
| `apps/web/app/globals.css` | Tailwind 진입점 |
| `apps/web/postcss.config.mjs` | Tailwind v4 플러그인 |
| `apps/web/components.json` | shadcn 설정 |
| `apps/web/components/ui/*.tsx` | shadcn 컴포넌트 (Table, Badge, Button, Input, Select) |
| `apps/web/lib/utils.ts` | shadcn `cn()` |
| `apps/web/lib/dashboard.ts` | 순수 로직 — 경고 판정, 축 막대 비율, 상대시각 |
| `apps/web/app/actions.ts` | Server Action — `loadMoreJobs`, `toggleBookmark` |
| `apps/web/app/_components/status-strip.tsx` | 상태 스트립 (서버) |
| `apps/web/app/_components/job-list.tsx` | 목록 + 필터 + 무한스크롤 (클라이언트) |
| `apps/web/app/_components/job-card.tsx` | 공고 카드 한 행 |
| `apps/web/app/_components/score-bars.tsx` | 축별 막대 |
| `apps/web/app/error.tsx` | 조회 실패 표시 |
| `apps/web/app/jobs/[id]/page.tsx` | 상세 (서버) |
| `apps/web/app/jobs/[id]/not-found.tsx` | 없는 공고 |
| `apps/web/test/dashboard.test.ts` | 순수 로직 테스트 |

**수정**

| 경로 | 무엇 |
| --- | --- |
| `packages/db/src/types.ts` | 대시보드 타입 + `RunPipeline` |
| `packages/db/src/store.ts` | 메서드 4개 추가, `startRun` 시그니처 |
| `packages/db/src/memory-store.ts` | 같은 구현 + `runs` 저장 |
| `packages/db/src/supabase-store.ts` | 같은 구현 |
| `packages/db/test/store-contract.ts` | 새 메서드 계약 |
| `packages/graph/src/pipelines/collect.ts` | `startRun('collect', trigger)` |
| `packages/graph/src/pipelines/notify.ts` | `startRun('notify', trigger)` |
| `packages/graph/test/discover.test.ts`, `runner.test.ts` | `startRun` 호출 수정 |
| `apps/web/app/layout.tsx` | `globals.css` import, `noindex` |
| `apps/web/app/page.tsx` | 대시보드로 교체 |
| `apps/web/package.json` | Tailwind·shadcn 의존성 |

---

## Task 1: `runs.pipeline` 마이그레이션과 배선

`runs`에 `trigger`(cron/manual/cli)만 있어 collect인지 notify인지 구분할 수 없다. 아무 항목도 처리하지 않은 실행은 `node_runs`가 비어 역추적도 불가능하다(실측: 최근 6건 중 2건). 상태 스트립의 "마지막 collect 실행"이 여기 걸린다.

**Files:**
- Create: `packages/db/migrations/0003_runs_pipeline.sql`
- Modify: `packages/db/src/types.ts`, `packages/db/src/store.ts:33`, `packages/db/src/memory-store.ts:182`, `packages/db/src/supabase-store.ts:305-310`, `packages/db/test/store-contract.ts`, `packages/graph/src/pipelines/collect.ts:32`, `packages/graph/src/pipelines/notify.ts:30`, `packages/graph/test/discover.test.ts:141`, `packages/graph/test/runner.test.ts:12`

**Interfaces:**
- Produces: `RunPipeline = 'collect' | 'notify'`, `startRun(pipeline: RunPipeline, trigger: RunTrigger): Promise<string>`, `MemoryStore.runs` 배열

- [ ] **Step 1: 마이그레이션 파일 작성**

`packages/db/migrations/0003_runs_pipeline.sql`:

```sql
-- 이 파일은 Supabase 대시보드 SQL 에디터에서 사람이 직접 실행한다
-- (레포에 마이그레이션 러너가 없다). `if not exists`라 재실행해도 안전하다.
--
-- 왜 필요한가: runs에는 trigger(cron/manual/cli)만 있어 collect인지 notify인지
-- 구분할 수 없다. node_runs로 역추적할 수 있지만, 아무 항목도 처리하지 않은
-- 실행(후보가 없어 skip한 notify, 신규 0건인 collect)은 node_runs가 비어 있어
-- 판별이 불가능하다. 대시보드가 "마지막 collect가 언제 돌았나"에 답하려면 필요하다.
--
-- not null을 걸지 않는다 — 기존 행에는 값이 없고 소급해 채울 근거가 없다.
alter table runs add column if not exists pipeline text;
```

- [ ] **Step 2: 타입 추가**

`packages/db/src/types.ts`의 `RunTrigger` 선언 바로 아래:

```ts
export type RunPipeline = 'collect' | 'notify'
```

- [ ] **Step 3: 계약 테스트 작성 (실패 확인용)**

`packages/db/test/store-contract.ts`의 `describe` 블록 안 끝에 추가:

```ts
    test('startRun은 pipeline을 기록하고 getDashboardStats가 되돌려준다', async () => {
      await store.startRun('collect', 'cron')
      await store.startRun('notify', 'manual')
      const stats = await store.getDashboardStats()
      expect(stats.recentRuns.map((r) => r.pipeline)).toContain('collect')
      expect(stats.recentRuns.map((r) => r.pipeline)).toContain('notify')
    })
```

이 테스트는 Task 3의 `getDashboardStats`에 의존한다. **Task 1에서는 이 테스트를 넣지 말고**, `startRun` 시그니처만 바꾼 뒤 기존 테스트가 통과하는지로 검증한다. 위 테스트는 Task 3 Step 1에서 추가한다.

- [ ] **Step 4: Store 포트 시그니처 변경**

`packages/db/src/store.ts:33`을 교체:

```ts
  /** pipeline은 대시보드가 collect/notify를 구분하는 유일한 근거다 (node_runs는 빈 실행에서 비어 있다). */
  startRun(pipeline: RunPipeline, trigger: RunTrigger): Promise<string>
```

같은 파일 상단 import에 `RunPipeline`을 추가한다.

- [ ] **Step 5: MemoryStore 구현 — run을 실제로 저장**

`packages/db/src/memory-store.ts`. 지금은 id만 반환하고 아무것도 저장하지 않는다. Task 3의 통계가 이 데이터를 읽으므로 저장하도록 바꾼다.

클래스 필드에 추가 (`nodeRuns` 옆):

```ts
  readonly runs: { id: string; pipeline: RunPipeline; trigger: RunTrigger; startedAt: string; endedAt: string | null }[] = []
```

`startRun`/`endRun` 교체:

```ts
  async startRun(pipeline: RunPipeline, trigger: RunTrigger) {
    const id = this.nextId('run')
    this.runs.push({ id, pipeline, trigger, startedAt: new Date().toISOString(), endedAt: null })
    return id
  }

  async endRun(runId: string) {
    const run = this.runs.find((r) => r.id === runId)
    if (run) run.endedAt = new Date().toISOString()
  }
```

import에 `RunPipeline`을 추가한다.

- [ ] **Step 6: SupabaseStore 구현**

`packages/db/src/supabase-store.ts:305-310` 교체:

```ts
    async startRun(pipeline: RunPipeline, trigger: RunTrigger) {
      const row = unwrap<{ id: string }>(
        await db.from('runs').insert({ pipeline, trigger }).select('id').single(),
      )
      return row.id
    },
```

import에 `RunPipeline`을 추가한다.

- [ ] **Step 7: 호출부 4곳 수정**

- `packages/graph/src/pipelines/collect.ts:32` → `await store.startRun('collect', trigger)`
- `packages/graph/src/pipelines/notify.ts:30` → `await store.startRun('notify', trigger)`
- `packages/graph/test/discover.test.ts:141` → `await store.startRun('collect', 'cron')`
- `packages/graph/test/runner.test.ts:12` → `await store.startRun('collect', 'cron')`

- [ ] **Step 8: 테스트와 타입 검사**

```bash
pnpm test && pnpm typecheck
```

Expected: 112개 통과, typecheck 7/7.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat(db): record which pipeline a run belongs to

runs에는 trigger만 있어 collect/notify를 구분할 수 없었다. node_runs로
역추적할 수 있지만 아무 항목도 처리하지 않은 실행은 node_runs가 비어 판별이
불가능하다 — 실측상 최근 6건 중 2건이 그렇다. 대시보드의 '마지막 collect 실행'이
여기에 걸린다.

MemoryStore가 지금까지 run을 저장하지 않고 id만 반환했는데, 대시보드 통계가
이 데이터를 읽으므로 실제로 저장하도록 바꿨다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `listDashboardJobs` — 복합 커서 페이징

목록의 데이터 소스. **커서가 이 태스크의 핵심이고 테스트가 그 근거다.**

**Files:**
- Modify: `packages/db/src/types.ts`, `packages/db/src/store.ts`, `packages/db/src/memory-store.ts`, `packages/db/src/supabase-store.ts`, `packages/db/test/store-contract.ts`

**Interfaces:**
- Consumes: Task 1의 `RunPipeline` (직접 쓰지는 않음)
- Produces: `DashboardRow`, `DashboardCursor`, `DashboardPage`, `DashboardFilters`, `Store.listDashboardJobs`

- [ ] **Step 1: 타입 정의**

`packages/db/src/types.ts` 끝에 추가:

```ts
/** 목록용. reasoning을 넣지 않는다 — 168행 페이로드 107KB 중 64KB가 reasoning인데 목록에서는 표시하지 않는다. */
export interface DashboardRow {
  jobId: string
  companyName: string
  position: string
  url: string
  dueTime: string | null
  bookmarked: boolean
  total: number
  breakdown: Record<string, number>
  notifiedAt: string | null
}

/**
 * 커서가 두 값인 이유: 점수 동점이 흔하다(실측 168건이 60개 값에 몰려 있고
 * 151행이 동점, 최대 9행). total 단독 커서로는 페이지 경계에서 행이 누락되거나
 * 중복된다. offset도 쓰지 않는다 — 북마크 토글이나 신규 채점으로 순서가 밀린다.
 */
export interface DashboardCursor {
  total: number
  jobId: string
}

export interface DashboardFilters {
  minScore?: number
  bookmarkedOnly?: boolean
  unnotifiedOnly?: boolean
}

export interface DashboardPage {
  rows: DashboardRow[]
  nextCursor: DashboardCursor | null
}
```

- [ ] **Step 2: 실패하는 계약 테스트 작성**

`packages/db/test/store-contract.ts`. 먼저 파일 상단 헬퍼 옆에 점수 시드 헬퍼를 추가한다:

```ts
const seedScored = async (store: Store, specs: { ext: string; total: number }[]) => {
  const created = await store.insertJobs(specs.map((s) => job(s.ext)))
  for (const [i, spec] of specs.entries()) {
    await store.saveScore({
      jobId: created[i]!.id, total: spec.total,
      breakdown: { stack: spec.total, role: 0, domain: 0, growth: 0, conditions: 0 },
      reasoning: `r${spec.ext}`, scorer: 'routine', rubricVersion: 'v3',
    })
  }
  return created
}
```

`describe` 블록 안에 테스트 3개를 추가한다:

```ts
    test('listDashboardJobs는 점수 내림차순으로 자르고 커서를 준다', async () => {
      await seedScored(store, [
        { ext: '1', total: 90 }, { ext: '2', total: 70 }, { ext: '3', total: 80 },
      ])
      const page = await store.listDashboardJobs({ limit: 2 })
      expect(page.rows.map((r) => r.total)).toEqual([90, 80])
      expect(page.nextCursor).toEqual({ total: 80, jobId: page.rows[1]!.jobId })
    })

    // 동점이 페이지 경계에 걸리면 total 단독 커서는 행을 건너뛰거나 중복시킨다.
    test('동점 경계를 넘어가도 누락도 중복도 없다', async () => {
      await seedScored(store, [
        { ext: '1', total: 74 }, { ext: '2', total: 74 }, { ext: '3', total: 74 },
        { ext: '4', total: 74 }, { ext: '5', total: 60 },
      ])
      const seen: string[] = []
      let cursor: DashboardCursor | undefined
      for (let guard = 0; guard < 10; guard++) {
        const page: DashboardPage = await store.listDashboardJobs({ limit: 2, cursor })
        seen.push(...page.rows.map((r) => r.jobId))
        if (!page.nextCursor) break
        cursor = page.nextCursor
      }
      expect(seen).toHaveLength(5)
      expect(new Set(seen).size).toBe(5)
    })

    test('필터는 최소 점수·북마크·미발송을 각각 좁힌다', async () => {
      const created = await seedScored(store, [
        { ext: '1', total: 90 }, { ext: '2', total: 50 },
      ])
      expect((await store.listDashboardJobs({ limit: 10, minScore: 60 })).rows).toHaveLength(1)

      await store.setJobBookmarked(created[1]!.id, true)
      const marked = await store.listDashboardJobs({ limit: 10, bookmarkedOnly: true })
      expect(marked.rows.map((r) => r.total)).toEqual([50])

      const ntf = await store.createNotification([created[0]!.id])
      await store.markNotificationSent(ntf.id)
      const unnotified = await store.listDashboardJobs({ limit: 10, unnotifiedOnly: true })
      expect(unnotified.rows.map((r) => r.total)).toEqual([50])
    })
```

`DashboardCursor`, `DashboardPage`를 파일 상단 import에 추가한다.

`setJobBookmarked`는 Task 3에서 만든다. **이 태스크에서는 세 번째 테스트의 북마크 부분을 빼고** 최소 점수와 미발송만 검증한 뒤, Task 3에서 북마크 검증을 추가한다.

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm vitest run packages/db
```

Expected: FAIL — `store.listDashboardJobs is not a function`

- [ ] **Step 4: 포트에 선언**

`packages/db/src/store.ts`의 관측 섹션 위에 추가:

```ts
  // ── 대시보드 조회
  listDashboardJobs(
    params: DashboardFilters & { cursor?: DashboardCursor; limit: number },
  ): Promise<DashboardPage>
```

- [ ] **Step 5: MemoryStore 구현**

```ts
  async listDashboardJobs(
    params: DashboardFilters & { cursor?: DashboardCursor; limit: number },
  ): Promise<DashboardPage> {
    const rows = [...this.scores.values()]
      .map((score) => ({ score, job: this.jobs.get(score.jobId)! }))
      .filter(({ job, score }) =>
        job && !job.hidden && score.status === 'ok'
        && (params.minScore === undefined || score.total >= params.minScore)
        && (!params.bookmarkedOnly || job.bookmarked)
        && (!params.unnotifiedOnly || score.notifiedAt === null))
      // SupabaseStore와 같은 순서여야 한다 — 동점은 jobId 내림차순으로 갈린다.
      .sort((a, b) => b.score.total - a.score.total || (a.job.id < b.job.id ? 1 : -1))
      .filter(({ job, score }) => !params.cursor
        || score.total < params.cursor.total
        || (score.total === params.cursor.total && job.id < params.cursor.jobId))
      .slice(0, params.limit)
      .map(({ job, score }) => ({
        jobId: job.id, companyName: job.companyName, position: job.position,
        url: job.url, dueTime: job.dueTime, bookmarked: job.bookmarked,
        total: score.total, breakdown: score.breakdown, notifiedAt: score.notifiedAt,
      }))
    const last = rows[rows.length - 1]
    return {
      rows,
      nextCursor: rows.length === params.limit && last
        ? { total: last.total, jobId: last.jobId } : null,
    }
  }
```

- [ ] **Step 6: SupabaseStore 구현**

`raw`와 JD 본문은 제외한다 — 목록에서 쓰지 않는데 가장 크다.

```ts
const DASHBOARD_SELECT =
  'total, breakdown, notified_at, jobs!inner(id, company_name, position, url, due_time, bookmarked, hidden)'

// (store 객체 안)
    async listDashboardJobs(
      params: DashboardFilters & { cursor?: DashboardCursor; limit: number },
    ): Promise<DashboardPage> {
      let q = db.from('scores').select(DASHBOARD_SELECT)
        .eq('status', 'ok').eq('jobs.hidden', false)
        .order('total', { ascending: false })
        .order('job_id', { ascending: false })
        .limit(params.limit)
      if (params.minScore !== undefined) q = q.gte('total', params.minScore)
      if (params.bookmarkedOnly) q = q.eq('jobs.bookmarked', true)
      if (params.unnotifiedOnly) q = q.is('notified_at', null)
      if (params.cursor) {
        // keyset: (total, job_id) < (cursor.total, cursor.jobId)
        q = q.or(`total.lt.${params.cursor.total},and(total.eq.${params.cursor.total},job_id.lt.${params.cursor.jobId})`)
      }
      const raw = unwrap<DashboardJoinRow[]>(await q)
      const rows = raw.map((r) => ({
        jobId: r.jobs.id, companyName: r.jobs.company_name, position: r.jobs.position,
        url: r.jobs.url, dueTime: r.jobs.due_time, bookmarked: r.jobs.bookmarked,
        total: r.total, breakdown: r.breakdown, notifiedAt: r.notified_at,
      }))
      const last = rows[rows.length - 1]
      return {
        rows,
        nextCursor: rows.length === params.limit && last
          ? { total: last.total, jobId: last.jobId } : null,
      }
    },
```

파일 상단 타입 선언부에 추가:

```ts
type DashboardJoinRow = {
  total: number; breakdown: Record<string, number>; notified_at: string | null
  jobs: {
    id: string; company_name: string; position: string; url: string
    due_time: string | null; bookmarked: boolean; hidden: boolean
  }
}
```

**주의:** PostgREST의 1:1 embed는 배열이 아니라 객체다. `r.jobs[0]`이 아니라 `r.jobs`다.

- [ ] **Step 7: 테스트 통과 확인**

```bash
pnpm vitest run packages/db && pnpm typecheck
```

Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat(db): add cursor-paged dashboard job query

커서를 (total, job_id) 복합키로 잡는다. 점수 동점이 흔해서 — 실측 168건이
60개 값에 몰려 있고 151행이 동점, 최대 9행 — total 단독 커서로는 페이지
경계에서 행이 누락되거나 중복된다. offset도 쓰지 않는다: 북마크 토글이나
신규 채점으로 순서가 밀리면 같은 행을 다시 보게 된다.

목록 조회에서 raw와 JD 본문을 제외한다. 168행 페이로드 107KB 중 64KB가
reasoning인데 목록에서는 표시하지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 상세·통계·북마크 Store 메서드

**Files:**
- Modify: `packages/db/src/types.ts`, `packages/db/src/store.ts`, `packages/db/src/memory-store.ts`, `packages/db/src/supabase-store.ts`, `packages/db/test/store-contract.ts`

**Interfaces:**
- Consumes: Task 1 `RunPipeline`, Task 2 `DashboardRow`
- Produces: `RunSummary`, `DashboardStats`, `Store.getJobDetail`, `Store.getDashboardStats`, `Store.setJobBookmarked`

- [ ] **Step 1: 타입 정의**

`packages/db/src/types.ts` 끝에 추가:

```ts
export interface RunSummary {
  id: string
  /** 0003 적용 전에 생긴 행은 null이다. 화면에서는 '알 수 없음'으로 표시한다. */
  pipeline: RunPipeline | null
  trigger: RunTrigger
  startedAt: string
  endedAt: string | null
}

export interface DashboardStats {
  totalJobs: number
  scoredJobs: number
  /** null이면 아직 한 건도 채점되지 않았다. */
  lastScoredAt: string | null
  rubricVersions: Record<string, number>
  recentRuns: RunSummary[]
}
```

- [ ] **Step 2: 실패하는 계약 테스트 작성**

```ts
    test('getJobDetail은 공고 전문과 점수를 함께 준다', async () => {
      const [created] = await seedScored(store, [{ ext: '1', total: 88 }])
      const detail = await store.getJobDetail(created!.id)
      expect(detail?.job.companyName).toBe('ACME')
      expect(detail?.score.total).toBe(88)
      expect(detail?.score.reasoning).toBe('r1')
      expect(await store.getJobDetail('없는-id')).toBeNull()
    })

    test('setJobBookmarked는 값을 뒤집고 목록에 반영된다', async () => {
      const [created] = await seedScored(store, [{ ext: '1', total: 70 }])
      await store.setJobBookmarked(created!.id, true)
      expect((await store.listDashboardJobs({ limit: 10 })).rows[0]!.bookmarked).toBe(true)
      await store.setJobBookmarked(created!.id, false)
      expect((await store.listDashboardJobs({ limit: 10 })).rows[0]!.bookmarked).toBe(false)
    })

    test('getDashboardStats는 건수와 마지막 채점, 루브릭 분포를 준다', async () => {
      await seedScored(store, [{ ext: '1', total: 70 }, { ext: '2', total: 80 }])
      await store.insertJobs([job('3')])
      const stats = await store.getDashboardStats()
      expect(stats.totalJobs).toBe(3)
      expect(stats.scoredJobs).toBe(2)
      expect(stats.rubricVersions).toEqual({ v3: 2 })
      expect(stats.lastScoredAt).not.toBeNull()
    })

    test('startRun은 pipeline을 기록하고 getDashboardStats가 되돌려준다', async () => {
      await store.startRun('collect', 'cron')
      await store.startRun('notify', 'manual')
      const stats = await store.getDashboardStats()
      const pipelines = stats.recentRuns.map((r) => r.pipeline)
      expect(pipelines).toContain('collect')
      expect(pipelines).toContain('notify')
    })
```

Task 2 Step 2에서 뺀 북마크 검증을 세 번째 필터 테스트에 되돌린다.

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm vitest run packages/db
```

Expected: FAIL — `store.getJobDetail is not a function`

- [ ] **Step 4: 포트에 선언**

```ts
  getJobDetail(jobId: string): Promise<ScoredJob | null>
  getDashboardStats(): Promise<DashboardStats>
  setJobBookmarked(jobId: string, bookmarked: boolean): Promise<void>
```

`getJobDetail`은 기존 `ScoredJob`(`{ job, score }`)을 그대로 재사용한다 — 새 타입을 만들 이유가 없다.

- [ ] **Step 5: MemoryStore 구현**

```ts
  async getJobDetail(jobId: string): Promise<ScoredJob | null> {
    const job = this.jobs.get(jobId)
    const score = this.scores.get(jobId)
    return job && score ? { job, score } : null
  }

  async setJobBookmarked(jobId: string, bookmarked: boolean) {
    const job = this.jobs.get(jobId)
    if (job) this.jobs.set(jobId, { ...job, bookmarked })
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const scores = [...this.scores.values()]
    const rubricVersions: Record<string, number> = {}
    for (const s of scores) rubricVersions[s.rubricVersion] = (rubricVersions[s.rubricVersion] ?? 0) + 1
    const scoredAt = scores.map((s) => s.scoredAt).sort()
    return {
      totalJobs: this.jobs.size,
      scoredJobs: scores.length,
      lastScoredAt: scoredAt[scoredAt.length - 1] ?? null,
      rubricVersions,
      recentRuns: [...this.runs].reverse().slice(0, 5).map((r) => ({ ...r })),
    }
  }
```

- [ ] **Step 6: SupabaseStore 구현**

```ts
    async getJobDetail(jobId: string): Promise<ScoredJob | null> {
      const rows = unwrap<(ScoreRow & { jobs: JobRow })[]>(
        await db.from('scores').select('*, jobs(*)').eq('job_id', jobId).limit(1),
      )
      const row = rows[0]
      return row ? { job: toJob(row.jobs), score: toScore(row) } : null
    },

    async setJobBookmarked(jobId: string, bookmarked: boolean) {
      const { error } = await db.from('jobs').update({ bookmarked }).eq('id', jobId)
      if (error) throw new Error(error.message)
    },

    async getDashboardStats(): Promise<DashboardStats> {
      const [jobCount, scoreRows, runRows] = await Promise.all([
        db.from('jobs').select('*', { count: 'exact', head: true }),
        db.from('scores').select('rubric_version, scored_at').eq('status', 'ok'),
        db.from('runs').select('id, pipeline, trigger, started_at, ended_at')
          .order('started_at', { ascending: false }).limit(5),
      ])
      const scores = unwrap<{ rubric_version: string; scored_at: string }[]>(scoreRows)
      const rubricVersions: Record<string, number> = {}
      for (const s of scores) rubricVersions[s.rubric_version] = (rubricVersions[s.rubric_version] ?? 0) + 1
      const scoredAt = scores.map((s) => s.scored_at).sort()
      return {
        totalJobs: jobCount.count ?? 0,
        scoredJobs: scores.length,
        lastScoredAt: scoredAt[scoredAt.length - 1] ?? null,
        rubricVersions,
        recentRuns: unwrap<{
          id: string; pipeline: RunPipeline | null; trigger: RunTrigger
          started_at: string; ended_at: string | null
        }[]>(runRows).map((r) => ({
          id: r.id, pipeline: r.pipeline, trigger: r.trigger,
          startedAt: r.started_at, endedAt: r.ended_at,
        })),
      }
    },
```

`toScore`가 이 파일에 없으면 기존 `listNotifyCandidates`가 쓰는 매핑 로직을 함수로 빼서 재사용한다 — 같은 매핑을 두 번 쓰지 않는다.

- [ ] **Step 7: 테스트와 타입 검사**

```bash
pnpm test && pnpm typecheck
```

Expected: 전부 통과

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat(db): add job detail, dashboard stats, and bookmark write

getJobDetail은 기존 ScoredJob 타입을 재사용한다. getDashboardStats의
recentRuns는 0003 적용 전 행에서 pipeline이 null이며, 화면이 '알 수 없음'으로
표시한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Tailwind v4 + shadcn 셋업

`apps/web`에는 CSS 파일조차 없다. 이 태스크의 산출물은 **스타일이 적용된 화면이 실제로 뜨는 것**이다.

**Files:**
- Create: `apps/web/postcss.config.mjs`, `apps/web/app/globals.css`, `apps/web/lib/utils.ts`, `apps/web/components.json`, `apps/web/components/ui/*.tsx`
- Modify: `apps/web/package.json`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`

- [ ] **Step 1: Tailwind v4 설치**

```bash
pnpm --filter @job-finder/web add -D tailwindcss @tailwindcss/postcss postcss
```

- [ ] **Step 2: PostCSS 설정**

`apps/web/postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

- [ ] **Step 3: 전역 CSS**

`apps/web/app/globals.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 4: layout에 연결하고 색인 차단**

`apps/web/app/layout.tsx` 전체 교체:

```tsx
import './globals.css'

export const metadata = {
  title: 'Job Finder',
  // 인증이 없는 공개 페이지다. 채점 근거에 경력 정보가 담기므로 색인만은 막는다.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 5: Tailwind가 실제로 먹는지 확인**

`apps/web/app/page.tsx`를 임시로 교체:

```tsx
export default function Page() {
  return <main className="p-8 text-2xl font-bold text-blue-600">Tailwind 확인</main>
}
```

```bash
pnpm --filter @job-finder/web build
```

Expected: 빌드 성공. `pnpm --filter @job-finder/web dev` 후 브라우저에서 파란 굵은 글씨가 보이는지 눈으로 확인한다.

- [ ] **Step 6: shadcn 초기화**

```bash
cd apps/web && pnpm dlx shadcn@latest init
```

프롬프트에서 기본값을 택하되 스타일 경로가 `app/globals.css`, alias가 `@/*`인지 확인한다.

**모노레포에서 CLI가 실패하면** 직접 만든다: `apps/web/lib/utils.ts`에 `cn()`을 쓰고(`clsx` + `tailwind-merge`), 필요한 컴포넌트를 shadcn 레지스트리에서 복사해 `apps/web/components/ui/`에 둔다. 어느 경로든 산출물은 같다.

- [ ] **Step 7: 필요한 컴포넌트만 추가**

```bash
cd apps/web && pnpm dlx shadcn@latest add badge button input select
```

`Table`은 목록이 카드 레이아웃이라 쓰지 않는다. 추가하지 마라.

- [ ] **Step 8: 빌드와 타입 검사**

```bash
pnpm --filter @job-finder/web build && pnpm typecheck
```

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "chore(web): set up Tailwind v4 and shadcn

apps/web에 CSS 기반이 없었다. 이후 설정 편집 화면이 예정되어 있어 지금
깔아두지 않으면 손으로 쓴 CSS를 나중에 다시 쓰게 된다. 실제로 쓰는
컴포넌트만 가져온다.

공개 페이지이므로 layout metadata에 noindex를 넣는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 순수 로직과 상태 스트립

컴포넌트에 로직을 묻으면 테스트가 어려워진다. 먼저 순수 함수로 빼고 테스트한다.

**Files:**
- Create: `apps/web/lib/dashboard.ts`, `apps/web/test/dashboard.test.ts`, `apps/web/app/_components/status-strip.tsx`

**Interfaces:**
- Consumes: Task 3의 `DashboardStats`, `RunSummary`
- Produces: `isScoringStale`, `formatRelativeTime`, `axisPercent`, `<StatusStrip stats={...} />`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/test/dashboard.test.ts`:

```ts
import { expect, test } from 'vitest'
import { axisPercent, formatRelativeTime, isScoringStale } from '@/lib/dashboard'

const NOW = new Date('2026-08-16T00:00:00Z')

// 채점이 멈춘 것을 눈에 띄게 하는 게 이 화면의 목적이다.
test('마지막 채점이 7일을 넘으면 정지로 본다', () => {
  expect(isScoringStale('2026-08-15T00:00:00Z', NOW)).toBe(false)
  expect(isScoringStale('2026-08-09T00:00:00Z', NOW)).toBe(false)
  expect(isScoringStale('2026-08-08T23:00:00Z', NOW)).toBe(true)
})

test('한 번도 채점되지 않았으면 정지로 본다', () => {
  expect(isScoringStale(null, NOW)).toBe(true)
})

test('상대 시각을 한국어로 표기한다', () => {
  expect(formatRelativeTime('2026-08-15T23:30:00Z', NOW)).toBe('30분 전')
  expect(formatRelativeTime('2026-08-15T21:00:00Z', NOW)).toBe('3시간 전')
  expect(formatRelativeTime('2026-08-13T00:00:00Z', NOW)).toBe('3일 전')
  expect(formatRelativeTime(null, NOW)).toBe('없음')
})

test('축 점수를 막대 비율로 바꾼다', () => {
  expect(axisPercent(20)).toBe(100)
  expect(axisPercent(10)).toBe(50)
  expect(axisPercent(0)).toBe(0)
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm vitest run apps/web/test/dashboard.test.ts
```

Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`apps/web/lib/dashboard.ts`:

```ts
import { MAX_AXIS_SCORE } from '@job-finder/scoring'

/** 수동 채점 주기를 감안한 값. 이보다 벌어지면 사람이 손대야 한다. */
const STALE_DAYS = 7

export function isScoringStale(lastScoredAt: string | null, now: Date): boolean {
  if (!lastScoredAt) return true
  return now.getTime() - new Date(lastScoredAt).getTime() > STALE_DAYS * 86_400_000
}

export function formatRelativeTime(at: string | null, now: Date): string {
  if (!at) return '없음'
  const min = Math.floor((now.getTime() - new Date(at).getTime()) / 60_000)
  if (min < 60) return `${min}분 전`
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`
  return `${Math.floor(min / 1440)}일 전`
}

export function axisPercent(score: number): number {
  return (score / MAX_AXIS_SCORE) * 100
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm vitest run apps/web/test/dashboard.test.ts
```

Expected: PASS

- [ ] **Step 5: 상태 스트립 컴포넌트**

`apps/web/app/_components/status-strip.tsx`:

```tsx
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

export function StatusStrip({ stats, pendingNotify, now }: {
  stats: DashboardStats; pendingNotify: number; now: Date
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
        <Card label="알림 대기" value={`${pendingNotify}건`} />
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
```

- [ ] **Step 6: 타입 검사와 커밋**

```bash
pnpm typecheck && pnpm test
git add -A
git commit -m "feat(web): add dashboard pure logic and status strip

경고 판정과 시각 포맷을 컴포넌트 밖 순수 함수로 두고 테스트한다.
마지막 채점이 7일을 넘거나 루브릭 버전이 섞이면 카드를 경고 상태로 만든다 —
채점 정지를 눈에 띄게 하는 것이 이 화면의 목적이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: 목록 페이지 + 무한스크롤

**Files:**
- Create: `apps/web/app/actions.ts`, `apps/web/app/_components/job-card.tsx`, `apps/web/app/_components/job-list.tsx`, `apps/web/app/error.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: Task 2 `listDashboardJobs`, Task 3 `getDashboardStats`/`setJobBookmarked`, Task 5 `<StatusStrip>`
- Produces: Server Action `loadMoreJobs(filters, cursor)`, `toggleBookmark(jobId, next)`

- [ ] **Step 1: Server Action 작성**

`apps/web/app/actions.ts`:

```ts
'use server'

import type { DashboardCursor, DashboardFilters, DashboardPage } from '@job-finder/db'
import { revalidatePath } from 'next/cache'
import { getStore } from '@/lib/store'

export const PAGE_SIZE = 100

/**
 * 새 JSON API 라우트를 만들지 않고 Server Action을 쓴다 — 페이지가 공개라
 * 조회용 엔드포인트를 늘리면 표면만 넓어진다.
 */
export async function loadMoreJobs(
  filters: DashboardFilters, cursor?: DashboardCursor,
): Promise<DashboardPage> {
  return getStore().listDashboardJobs({ ...filters, cursor, limit: PAGE_SIZE })
}

export async function toggleBookmark(jobId: string, next: boolean): Promise<void> {
  await getStore().setJobBookmarked(jobId, next)
  revalidatePath('/')
  revalidatePath(`/jobs/${jobId}`)
}
```

- [ ] **Step 2: 카드 컴포넌트**

`apps/web/app/_components/job-card.tsx`:

```tsx
import type { DashboardRow } from '@job-finder/db'
import Link from 'next/link'

const AXES = ['stack', 'role', 'domain', 'growth', 'conditions'] as const

export function JobCard({ row, onToggleBookmark }: {
  row: DashboardRow
  onToggleBookmark: (jobId: string, next: boolean) => void
}) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-neutral-200 bg-white p-5">
      <div className="w-14 shrink-0 text-3xl font-bold tabular-nums">{row.total}</div>
      <div className="min-w-0 flex-1">
        <Link href={`/jobs/${row.jobId}`} className="block hover:underline">
          <div className="text-sm text-neutral-500">{row.companyName}</div>
          <div className="truncate text-lg font-medium">{row.position}</div>
        </Link>
        <div className="mt-2 text-xs text-neutral-500">
          {AXES.map((a) => `${a} ${row.breakdown[a] ?? 0}`).join(' · ')}
        </div>
        <div className="mt-1 text-xs text-neutral-400">
          {row.dueTime ? `마감 ${row.dueTime}` : '상시채용'}
          {row.notifiedAt ? ' · 발송됨' : ''}
        </div>
      </div>
      <button
        type="button"
        aria-label={row.bookmarked ? '북마크 해제' : '북마크'}
        onClick={() => onToggleBookmark(row.jobId, !row.bookmarked)}
        className="shrink-0 text-2xl leading-none"
      >
        {row.bookmarked ? '★' : '☆'}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: 목록 클라이언트 컴포넌트**

`apps/web/app/_components/job-list.tsx`:

```tsx
'use client'

import type { DashboardCursor, DashboardFilters, DashboardRow } from '@job-finder/db'
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
          <input
            type="number" min={0} max={100} step={5}
            className="w-20 rounded border border-neutral-300 px-2 py-1"
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
        <span className="text-neutral-400">{rows.length}건</span>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => setFilters((f) => ({ ...f }))}>
            다시 시도
          </button>
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
```

**주의:** 필터가 바뀌면 커서 없이 `loadMoreJobs(filters)`를 불러 처음부터 다시 받는다. 커서 페이징이라 클라이언트가 가진 행만 좁히면 이미 받은 범위 밖의 결과가 빠진다.

**경쟁 상태 주의:** 필터를 빠르게 연달아 바꾸면 늦게 시작한 요청이 먼저 도착할 수 있다. `cancelled` 플래그가 그것을 막는다 — 지우지 마라.

- [ ] **Step 4: 페이지 교체**

`apps/web/app/page.tsx`:

```tsx
import { getStore } from '@/lib/store'
import { PAGE_SIZE } from './actions'
import { JobList } from './_components/job-list'
import { StatusStrip } from './_components/status-strip'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const store = getStore()
  const [stats, first, profile] = await Promise.all([
    store.getDashboardStats(),
    store.listDashboardJobs({ limit: PAGE_SIZE }),
    store.getProfile(),
  ])
  const pending = await store.listDashboardJobs({
    limit: 500, minScore: profile.notifyRule.minScore, unnotifiedOnly: true,
  })

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <h1 className="text-2xl font-bold">Job Finder</h1>
      <StatusStrip stats={stats} pendingNotify={pending.rows.length} now={new Date()} />
      <JobList initialRows={first.rows} initialCursor={first.nextCursor} />
    </main>
  )
}
```

- [ ] **Step 5: 에러 경계**

`apps/web/app/error.tsx`:

```tsx
'use client'

// 운영용 화면이라 빈 화면보다 원인이 보이는 편이 낫다.
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-bold text-red-700">대시보드를 불러오지 못했습니다</h1>
      <pre className="mt-4 overflow-x-auto rounded bg-neutral-100 p-4 text-sm">{error.message}</pre>
      <button type="button" onClick={reset} className="mt-4 rounded border px-3 py-1">
        다시 시도
      </button>
    </main>
  )
}
```

- [ ] **Step 6: 빌드하고 실제로 확인**

```bash
pnpm --filter @job-finder/web build && pnpm typecheck && pnpm test
```

그다음 `.env.local`을 export한 채 dev 서버를 띄우고 **브라우저에서 직접 확인한다**:
- 상태 스트립에 `168 / 168`이 뜨는가
- 카드가 점수 내림차순인가
- 스크롤을 내리면 추가 로드되는가
- 최소 점수를 70으로 넣으면 목록이 줄어드는가
- 북마크 별을 눌렀다 새로고침하면 유지되는가

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat(web): add dashboard list with filters and infinite scroll

서버 컴포넌트가 첫 페이지와 통계를 조회하고, 클라이언트는 필터·무한스크롤·
북마크만 맡는다. service role 키가 브라우저로 내려가지 않는 경계다 —
페이지가 공개라 이게 유일한 방어선이다.

더 불러오기는 Server Action으로 한다. 공개 페이지에 조회용 JSON 엔드포인트를
늘리면 표면만 넓어진다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: 상세 페이지

**Files:**
- Create: `apps/web/app/jobs/[id]/page.tsx`, `apps/web/app/jobs/[id]/not-found.tsx`, `apps/web/app/_components/score-bars.tsx`

**Interfaces:**
- Consumes: Task 3 `getJobDetail`, Task 5 `axisPercent`

- [ ] **Step 1: 축 막대 컴포넌트**

`apps/web/app/_components/score-bars.tsx`:

```tsx
import { axisPercent } from '@/lib/dashboard'

const AXES = [
  ['stack', '기술 스택'], ['role', '역할·연차'], ['domain', '도메인'],
  ['growth', '회사 성장성'], ['conditions', '근무 조건'],
] as const

export function ScoreBars({ breakdown }: { breakdown: Record<string, number> }) {
  return (
    <dl className="space-y-2">
      {AXES.map(([key, label]) => {
        const v = breakdown[key] ?? 0
        return (
          <div key={key} className="flex items-center gap-3">
            <dt className="w-24 shrink-0 text-sm text-neutral-600">{label}</dt>
            <dd className="flex flex-1 items-center gap-2">
              <div className="h-2 flex-1 rounded bg-neutral-200">
                <div className="h-2 rounded bg-neutral-800" style={{ width: `${axisPercent(v)}%` }} />
              </div>
              <span className="w-6 text-right text-sm tabular-nums">{v}</span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
```

- [ ] **Step 2: 상세 페이지**

`apps/web/app/jobs/[id]/page.tsx`:

```tsx
import { getStore } from '@/lib/store'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ScoreBars } from '../../_components/score-bars'

export const dynamic = 'force-dynamic'

function Section({ title, body }: { title: string; body: string | null | undefined }) {
  if (!body) return null
  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-500">{title}</h2>
      <p className="mt-2 whitespace-pre-wrap leading-relaxed">{body}</p>
    </section>
  )
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getStore().getJobDetail(id)
  if (!detail) notFound()
  const { job, score } = detail

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">← 목록</Link>

      <header className="space-y-1">
        <div className="text-sm text-neutral-500">{job.companyName}</div>
        <h1 className="text-2xl font-bold">{job.position}</h1>
        <div className="flex items-center gap-4 pt-2">
          <span className="text-4xl font-bold tabular-nums">{score.total}</span>
          <a href={job.url} target="_blank" rel="noreferrer"
            className="rounded border px-3 py-1 text-sm hover:bg-neutral-100">
            원티드에서 보기
          </a>
        </div>
      </header>

      <div className="rounded-lg border border-neutral-200 bg-white p-5 space-y-4">
        <ScoreBars breakdown={score.breakdown} />
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{score.reasoning}</p>
        <div className="text-xs text-neutral-400">
          {score.rubricVersion} · {score.scoredAt.slice(0, 10)} 채점 · {score.scorer}
        </div>
      </div>

      <div className="space-y-6">
        <Section title="회사 소개" body={job.intro} />
        <Section title="주요 업무" body={job.mainTasks} />
        <Section title="자격 요건" body={job.requirements} />
        <Section title="우대 사항" body={job.preferredPoints} />
        <Section title="복지" body={job.benefits} />
        {job.skillTags?.length ? (
          <section>
            <h2 className="text-sm font-semibold text-neutral-500">기술 태그</h2>
            <p className="mt-2 text-sm">{job.skillTags.join(' · ')}</p>
          </section>
        ) : null}
        <div className="text-sm text-neutral-500">
          {job.dueTime ? `마감 ${job.dueTime}` : '상시채용'}
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: not-found**

`apps/web/app/jobs/[id]/not-found.tsx`:

```tsx
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-bold">공고를 찾을 수 없습니다</h1>
      <p className="mt-2 text-neutral-600">채점되지 않았거나 삭제된 공고입니다.</p>
      <Link href="/" className="mt-4 inline-block underline">목록으로</Link>
    </main>
  )
}
```

- [ ] **Step 4: 빌드하고 실제로 확인**

```bash
pnpm --filter @job-finder/web build && pnpm typecheck && pnpm test
```

dev 서버에서 목록의 카드를 눌러 상세로 넘어가는지, 공고 본문 6개 절이 다 나오는지, 없는 id로 접근하면 not-found가 뜨는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat(web): add job detail page

DB에 Wanted 상세 응답을 이미 저장하고 있어서 원티드로 나가지 않고도
공고 전문을 읽을 수 있다. 채점 근거는 여기에서만 보여준다 — 목록에 넣으면
페이로드의 60%가 아무도 안 보는 텍스트가 된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: 배포와 실데이터 검증

**Files:** 없음 (검증과 문서만)

- [ ] **Step 1: 마이그레이션 적용 요청**

`packages/db/migrations/0003_runs_pipeline.sql`의 SQL을 사용자에게 제시하고 Supabase 대시보드 SQL Editor에서 실행하도록 요청한다.

**배포보다 먼저다.** 적용 전에 새 코드가 배포되면 `startRun`이 없는 컬럼에 쓰려다 실패해 collect·notify가 둘 다 시작 지점에서 죽는다.

- [ ] **Step 2: 적용 확인**

```bash
set -a; . .env.local; set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/runs?select=pipeline&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Expected: 에러가 아닌 배열. `column runs.pipeline does not exist`가 나오면 아직 적용되지 않은 것이다.

- [ ] **Step 3: 푸시하고 배포 대기**

```bash
git push origin main
```

Vercel이 자동 재배포한다.

- [ ] **Step 4: 프로덕션 검증**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://jobsonar.vercel.app/
curl -s https://jobsonar.vercel.app/ | grep -c "noindex"
```

브라우저에서 `https://jobsonar.vercel.app/`를 열어 확인한다:
- 상태 스트립 4개 카드에 실제 값 (`168 / 168`, 마지막 채점 시각, 알림 대기, `v3: 168`)
- 카드 목록이 점수 내림차순, 최상단이 84점 아이벡스
- 스크롤 시 추가 로드
- 카드를 눌러 상세로, 공고 본문이 보임
- 북마크가 새로고침 후에도 유지

- [ ] **Step 5: 파이프라인이 안 깨졌는지 확인**

`startRun` 시그니처가 바뀌었으므로 두 cron 경로를 직접 호출한다.

```bash
set -a; . .env.local; set +a
curl -s "https://jobsonar.vercel.app/api/cron/collect" -H "Authorization: Bearer $CRON_SECRET"
curl -s "https://jobsonar.vercel.app/api/cron/notify" -H "Authorization: Bearer $CRON_SECRET"
```

Expected: 둘 다 200이고 `failed: []`. 그다음 `runs` 테이블에 `pipeline`이 `collect`/`notify`로 찍혔는지 확인한다.

- [ ] **Step 6: 운영 문서 갱신**

`docs/operations.md`에 절을 추가한다: 대시보드 URL, 인증 없음과 그 결과(§9), `0003` 적용이 배포 선행 조건이라는 점.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "docs: record dashboard deployment notes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

---

## 자체 검토 결과

**스펙 커버리지** — §3.1 상태 스트립 → Task 5, 공고 카드·필터 → Task 6, §3.2 상세 → Task 7, §4 데이터 흐름 → Task 6, §5 커서 → Task 2, §6 Store 4개 → Task 2·3, §7 마이그레이션 → Task 1·8, §8 UI 기반 → Task 4, §9 noindex → Task 4 Step 4, §10 에러 처리 → Task 6 Step 5·Task 7 Step 3, §11 테스트 → Task 2·3·5. 누락 없음.

**타입 일관성** — `DashboardRow`·`DashboardCursor`·`DashboardPage`·`DashboardFilters`(Task 2), `RunSummary`·`DashboardStats`(Task 3), `RunPipeline`(Task 1)이 이후 태스크에서 같은 이름으로 쓰인다. `getJobDetail`은 새 타입 대신 기존 `ScoredJob`을 반환한다.

**알려진 순서 의존** — Task 2 Step 2의 필터 테스트는 `setJobBookmarked`(Task 3)를 쓰므로, Task 2에서는 북마크 부분을 빼고 Task 3 Step 2에서 되돌린다. 각 태스크 본문에 명시했다.

# Remember 소스 추가 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채용 공고 수집원을 Wanted 한 곳에서 Remember를 포함한 둘로 늘리고, 두 소스에 걸친 중복 공고를 표시한다.

**Architecture:** 단일 `JobSource`를 주입받던 파이프라인을 `Record<Source, JobSource>` 레지스트리로 바꾸고, discover / fetchDetail / recheck 세 노드가 처리 중인 **행의 `source`를 보고** 구현을 고른다. Remember는 Blind와 달리 HTML이 아니라 비인증 JSON API를 쓴다. 교차 중복은 행을 지우지 않고 `jobs.duplicate_of` 포인터로 표시한다.

**Tech Stack:** TypeScript (ESM, `.js` 확장자로 `.ts` 참조), pnpm workspace + turbo, vitest, zod, Supabase(PostgREST), Next.js App Router

**Spec:** [docs/superpowers/specs/2026-09-17-remember-source-design.md](../specs/2026-09-17-remember-source-design.md)

## Global Constraints

- **테스트는 루트 vitest 하나가 관장한다.** `pnpm test`로 전체, `pnpm vitest run <경로>`로 단일 파일. **`pnpm -r test`를 쓰지 마라** — 워크스페이스에 `test` 스크립트가 없어 조용히 성공한다.
- **노드는 절대 throw하지 않는다.** `NodeResult`를 반환한다 (`ok` / `fail(code, message, retryable)`).
- **마이그레이션은 수동 적용이다.** 러너가 없다. 파일만 만들고, 적용은 사람이 Supabase 대시보드 SQL Editor에서 한다. 적용된 파일은 수정하지 않는다.
- **`packages/db/test/supabase-store.test.ts`는 대상 프로젝트의 모든 테이블을 비운다.** `SUPABASE_TEST_ALLOW_TRUNCATE=1` 없이는 skip된다. **이 값을 켜지 마라.**
- **Store 인터페이스를 바꾸면 네 파일이 같이 움직인다**: `store.ts`, `memory-store.ts`, `supabase-store.ts`, `test/store-contract.ts`.
- **주석은 한국어로, "왜"를 쓴다.** 무엇을 하는지는 코드가 말한다. 기존 근거 주석을 지우지 마라.
- 상대 import는 `.js` 확장자로 `.ts`를 가리킨다 (`import { x } from './y.js'`).
- 새 소스 문자열: `'remember'`. Remember API base: `https://career-api.rememberapp.co.kr`. 공고 URL base: `https://career.rememberapp.co.kr/job/postings/`.

---

### Task 1: 소스 공용 모듈 — `SourceHttpError`와 `normalizeDueTime`

`WantedHttpError`를 세 노드가 `instanceof`로 검사하고 있어, 두 번째 소스가 던지는 오류는 전부 `retryable: false`로 떨어진다. 베이스 클래스를 만들어 먼저 푼다.

**Files:**
- Create: `packages/sources/src/http.ts`
- Create: `packages/sources/src/date.ts`
- Create: `packages/sources/test/date.test.ts`
- Modify: `packages/sources/src/wanted/client.ts`
- Modify: `packages/sources/src/wanted/normalize.ts`
- Modify: `packages/sources/src/index.ts`
- Modify: `packages/graph/src/nodes/discover.ts:24-25`
- Modify: `packages/graph/src/nodes/fetch-detail.ts:41-42`
- Modify: `packages/graph/src/nodes/recheck.ts:29-31`
- Modify: `packages/graph/test/discover.test.ts`, `packages/graph/test/fetch-detail.test.ts`, `packages/graph/test/recheck.test.ts`

**Interfaces:**
- Produces: `SourceHttpError` (class, `status: number`, `retryable: boolean` getter), `normalizeDueTime(raw: string | null | undefined): string | null`
- Produces: 노드 실패 코드가 `'WANTED_HTTP'` → `'SOURCE_HTTP'`로 바뀐다

- [ ] **Step 1: `normalizeDueTime`의 실패 케이스 테스트를 쓴다**

`packages/sources/test/date.test.ts`:

```ts
import { expect, test } from 'vitest'
import { normalizeDueTime } from '../src/index.js'

test('ISO 문자열에서 날짜 앞부분만 남긴다', () => {
  expect(normalizeDueTime('2026-09-17T12:00:00.000+09:00')).toBe('2026-09-17')
})

// 모양만 맞는 정규식은 2026-02-30을 통과시키고, Postgres가 date 컬럼에서
// 22007로 배치 insert 전체를 죽인다. Date 왕복으로 실재하는 날짜인지 확인한다.
test('달력에 없는 날짜는 null이다', () => {
  expect(normalizeDueTime('2026-02-30')).toBeNull()
  expect(normalizeDueTime('2026-13-01')).toBeNull()
})

test('빈 값은 null이다', () => {
  expect(normalizeDueTime(null)).toBeNull()
  expect(normalizeDueTime(undefined)).toBeNull()
  expect(normalizeDueTime('')).toBeNull()
  expect(normalizeDueTime('상시채용')).toBeNull()
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/sources/test/date.test.ts`
Expected: FAIL — `normalizeDueTime` is not exported

- [ ] **Step 3: `packages/sources/src/date.ts`를 만든다**

`packages/sources/src/wanted/normalize.ts`의 `normalizeDueTime` 함수를 **그대로 잘라내** 옮긴다. 주석도 그대로 가져온다. 다만 그 주석이 왜 소스 공용인지 한 줄 덧붙인다:

```ts
/**
 * jobs.due_time is a Postgres `date` column: keep only a real calendar date's
 * YYYY-MM-DD prefix, else null. A shape-only regex would let "2026-02-30" through
 * (Postgres would then abort the whole batch insert with 22007), so the extracted
 * date is round-tripped through `Date` to confirm it doesn't overflow into another day.
 *
 * 소스 공용이다 — 이건 Wanted 응답의 특성이 아니라 우리 쪽 컬럼 타입의 제약이라,
 * 소스마다 복제하면 한 곳만 고쳐지고 나머지가 조용히 틀린다.
 */
export function normalizeDueTime(raw: string | null | undefined): string | null {
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!match) return null
  const dateStr = match[0]!
  const year = Number(match[1]!)
  const month = Number(match[2]!)
  const day = Number(match[3]!)
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  const isRealDate =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  return isRealDate ? dateStr : null
}
```

`wanted/normalize.ts`에서는 함수 본문을 지우고 맨 위에 import를 추가한다:

```ts
import { normalizeDueTime } from '../date.js'
```

`packages/sources/src/index.ts`에 한 줄 추가한다:

```ts
export { normalizeDueTime } from './date.js'
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run packages/sources/test/date.test.ts packages/sources/test/normalize.test.ts`
Expected: PASS (기존 normalize 테스트도 그대로 통과해야 한다 — 함수를 옮겼을 뿐이다)

- [ ] **Step 5: `SourceHttpError` 테스트를 쓴다**

`packages/sources/test/http.test.ts`:

```ts
import { expect, test } from 'vitest'
import { SourceHttpError, WantedHttpError } from '../src/index.js'

// 5xx·429·타임아웃(status 0)만 재시도 가치가 있다. 404/422는 영구 실패다.
test.each([
  [500, true], [503, true], [429, true], [0, true],
  [404, false], [422, false], [400, false],
])('status %i의 retryable은 %s다', (status, expected) => {
  expect(new SourceHttpError(status, 'x').retryable).toBe(expected)
})

// 노드는 베이스 타입으로만 검사한다 — 소스가 늘어도 노드를 안 고치기 위해서다.
test('WantedHttpError는 SourceHttpError로 잡힌다', () => {
  expect(new WantedHttpError(503, 'boom')).toBeInstanceOf(SourceHttpError)
})
```

- [ ] **Step 6: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/sources/test/http.test.ts`
Expected: FAIL — `SourceHttpError` is not exported

- [ ] **Step 7: `packages/sources/src/http.ts`를 만든다**

```ts
/**
 * 소스 공용 HTTP 오류. 그래프 노드는 이 타입으로만 검사한다 — 소스마다 다른
 * 오류 클래스를 노드가 알아야 하면, 소스를 하나 더 붙일 때마다 노드 세 개를
 * 같이 고쳐야 한다(그리고 안 고치면 조용히 retryable=false로 떨어진다).
 */
export class SourceHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'SourceHttpError'
  }
  /** 5xx·429·타임아웃(status 0)만 재시도 가치가 있다. 404/422는 영구 실패. */
  get retryable() {
    return this.status >= 500 || this.status === 429 || this.status === 0
  }
}
```

`packages/sources/src/wanted/client.ts`의 `WantedHttpError`를 서브클래스로 바꾼다. **`retryable` 게터는 지운다** — 베이스가 같은 규칙을 갖는다:

```ts
import { SourceHttpError } from '../http.js'

export class WantedHttpError extends SourceHttpError {
  constructor(status: number, message: string) {
    super(status, message)
    this.name = 'WantedHttpError'
  }
}
```

`packages/sources/src/index.ts`에 추가한다:

```ts
export { SourceHttpError } from './http.js'
```

- [ ] **Step 8: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run packages/sources/`
Expected: PASS (전부)

- [ ] **Step 9: 세 노드가 베이스 타입으로 검사하게 바꾼다**

`packages/graph/src/nodes/discover.ts` — import와 catch 블록:

```ts
import { SourceHttpError, type ExternalRef, type JobSource } from '@job-finder/sources'
```
```ts
        if (cause instanceof SourceHttpError) {
          return fail('SOURCE_HTTP', cause.message, cause.retryable)
        }
```

`packages/graph/src/nodes/fetch-detail.ts`:

```ts
import { SourceHttpError, type JobSource } from '@job-finder/sources'
```
```ts
        const retryable = cause instanceof SourceHttpError ? cause.retryable : false
        return reportFailure(deps.store, job.id, 'SOURCE_HTTP', messageOf(cause), retryable)
```

`packages/graph/src/nodes/recheck.ts`:

```ts
import { SourceHttpError, parseJobOpenState, type JobSource } from '@job-finder/sources'
```
```ts
        const retryable = cause instanceof SourceHttpError ? cause.retryable : false
        return fail('SOURCE_HTTP', messageOf(cause), retryable)
```

- [ ] **Step 10: 그래프 테스트의 코드 문자열을 갱신한다**

`packages/graph/test/` 아래에서 `'WANTED_HTTP'`를 `'SOURCE_HTTP'`로 바꾼다. `WantedHttpError`를 던지는 fake는 그대로 둔다 — 서브클래스가 베이스로 잡히는지가 이 테스트의 값이다.

Run: `grep -rn "WANTED_HTTP" packages/graph/test/`

- [ ] **Step 11: 전체 테스트와 타입체크**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 12: 커밋**

```bash
git add packages/sources packages/graph
git commit -m "refactor(sources): HTTP 오류와 마감일 정규화를 소스 공용으로 올린다

노드가 WantedHttpError를 instanceof로 검사하고 있어, 두 번째 소스가
던지는 오류는 전부 retryable=false로 떨어진다. 베이스 클래스로 올려
노드가 소스를 몰라도 되게 한다.

normalizeDueTime은 Wanted 응답의 특성이 아니라 우리 date 컬럼의 제약을
막는 함수라 소스마다 복제하면 안 된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `SearchParams` 판별 유니온과 `searches.source`

`Source`는 지금 멤버가 하나인 유니온이고 `SearchParams`는 Wanted 모양으로 고정돼 있다. 판별 유니온으로 바꾼다.

**Files:**
- Create: `packages/db/migrations/0010_searches_source.sql`
- Modify: `packages/db/src/types.ts:1`, `:18-34`
- Modify: `packages/db/src/supabase-store.ts:210-215`
- Modify: `packages/db/src/memory-store.ts`
- Modify: `packages/db/test/store-contract.ts`
- Modify: `packages/sources/src/wanted/parse-url.ts`
- Modify: `packages/sources/test/parse-url.test.ts`

**Interfaces:**
- Consumes: 없음 (Task 1과 독립)
- Produces: `WantedSearchParams`, `RememberSearchParams`, `SearchParams` (판별 유니온), `Search.source: Source`

> **`Source`는 이 태스크에서 넓히지 않는다.** `'remember'`를 지금 더하면 Task 3의
> `SourceRegistry = Record<Source, JobSource>`가 아직 존재하지 않는 `remember` 키를
> 요구해 컴파일이 안 된다. `Source`는 구현이 생기는 **Task 6에서 한 번에** 넓힌다.
> `RememberSearchParams.source: 'remember'`는 리터럴 타입이라 `Source`와 무관하게
> 지금 정의할 수 있다.
- Produces: `parseWantedSearchUrl(url)`가 `{ source: 'wanted', ... }`를 반환한다
- Produces: `buildWantedListUrl(params: WantedSearchParams, page)` — 파라미터 타입이 좁아진다

- [ ] **Step 1: 마이그레이션 파일을 만든다**

`packages/db/migrations/0010_searches_source.sql`:

```sql
-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `if not exists`라 재실행해도 안전하다.
--
-- 검색이 어느 사이트의 것인지 적는 컬럼이다. 지금까지는 소스가 하나뿐이라
-- params의 모양만 보고도 알 수 있었지만, Remember가 붙으면 params가 소스마다
-- 다른 모양이 되므로 무엇으로 파싱할지를 행이 직접 말해야 한다.
--
-- default 'wanted'라 이미 있는 행은 적용 전후 동작이 같다. 코드가 이 컬럼을
-- 읽기 시작하므로 **코드 배포보다 먼저 적용해야 한다.**
alter table searches add column if not exists source text not null default 'wanted';
```

- [ ] **Step 2: 실패하는 계약 테스트를 쓴다**

`packages/db/test/store-contract.ts`의 검색 관련 테스트에 추가한다 (파일 안에서 `listEnabledSearches`를 쓰는 블록을 찾아 그 옆에 둔다):

```ts
  test('검색은 자기 source를 들고 나온다', async () => {
    const store = await makeStore()
    await seedSearch(store, { source: 'remember' })
    const [search] = await store.listEnabledSearches()
    expect(search!.source).toBe('remember')
  })
```

`seedSearch` 헬퍼가 없다면 파일의 기존 시드 방식을 따른다. `MemoryStore`는 `searches` 배열에 직접 push하고, `SupabaseStore`는 insert한다.

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/db/test/memory-store.test.ts`
Expected: FAIL — `search.source`가 `undefined`

- [ ] **Step 4: 타입을 바꾼다**

`packages/db/src/types.ts` 맨 위의 `Source`는 **그대로 둔다** (`'wanted'`). 위 주의 참조.

`SearchParams`를 판별 유니온으로 바꾼다 (기존 `SearchParams` 인터페이스를 `WantedSearchParams`로 이름만 바꾸고 `source`를 얹는다):

```ts
export interface WantedSearchParams {
  source: 'wanted'
  jobGroupId: string
  tagTypeIds: string[]
  locations: string[]
  yearsFrom: number
  yearsTo: number
  country: string
  sort: string
}

/**
 * Remember 검색 페이지 URL의 ?search= JSON과 같은 모양(camelCase)이다.
 * API 본문은 snake_case를 받지만, 변환은 소스 구현이 명시적으로 한다 —
 * 여기서 미리 snake_case로 저장하면 저장값과 URL을 눈으로 대조할 수 없다.
 */
export interface RememberSearchParams {
  source: 'remember'
  jobCategoryNames: Array<{ level1: string; level2: string }>
  addresses: string[][]
  organizationType: string | null
  minExperience: number | null
}

export type SearchParams = WantedSearchParams | RememberSearchParams

export interface Search {
  id: string
  source: Source
  url: string
  params: SearchParams
  enabled: boolean
}
```

- [ ] **Step 5: 두 Store 구현을 맞춘다**

`packages/db/src/supabase-store.ts:214` — `SearchRow` 타입에 `source: Source`를 추가하고 매핑에 넣는다:

```ts
      return rows.map((r) => ({
        id: r.id, source: r.source, url: r.url, params: r.params, enabled: r.enabled,
      }))
```

`packages/db/src/memory-store.ts` — `searches` 배열은 `Search[]`라 타입만 맞으면 된다. 컴파일 오류가 나는 자리를 따라가 `source`를 채운다.

- [ ] **Step 6: `parseWantedSearchUrl`이 source를 붙이게 한다**

`packages/sources/src/wanted/parse-url.ts`의 반환 객체에 한 줄 추가:

```ts
  return {
    source: 'wanted',
    jobGroupId: segments[1],
    // ... 나머지 그대로
  }
```

시그니처도 좁힌다:

```ts
export function parseWantedSearchUrl(input: string): WantedSearchParams
export function buildWantedListUrl(
  params: WantedSearchParams,
  page: { limit: number; offset: number },
): string
```

import를 `import type { WantedSearchParams } from '@job-finder/db'`로 바꾼다.

- [ ] **Step 7: 테스트와 타입체크**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. 타입 오류가 남으면 `SearchParams`를 Wanted 모양으로 가정하던 자리다 — Task 3에서 풀 자리라면 `params.source === 'wanted'` 가드를 임시로 넣지 말고, Task 3까지 미루지 말고 그 자리에서 좁혀라.

- [ ] **Step 8: 커밋**

```bash
git add packages/db packages/sources
git commit -m "feat(db): 검색에 source를 붙이고 SearchParams를 판별 유니온으로 바꾼다

소스가 둘이 되면 searches.params의 모양이 소스마다 달라진다. 무엇으로
파싱할지를 행이 직접 말하게 하고, 잘못된 조합은 컴파일 타임에 막는다.

migration 0010은 default 'wanted'라 기존 행의 동작이 달라지지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `JobSource` 레지스트리 배선

세 노드가 `deps.source` 하나를 물고 있다. 행마다 고르게 바꾼다.

**Files:**
- Modify: `packages/sources/src/types.ts`
- Modify: `packages/sources/src/wanted/index.ts`
- Modify: `packages/graph/src/nodes/discover.ts`, `fetch-detail.ts`, `recheck.ts`
- Modify: `packages/graph/src/pipelines/collect.ts`
- Modify: `packages/graph/src/index.ts`
- Modify: `apps/web/app/api/cron/collect/route.ts`, `apps/web/app/api/run/route.ts`
- Modify: `tools/backfill/src/index.ts`
- Modify: `packages/graph/test/discover.test.ts`, `fetch-detail.test.ts`, `recheck.test.ts`, `collect.test.ts`

**Interfaces:**
- Consumes: Task 2의 `Source`, `SearchParams`
- Produces: `SourceRegistry = Record<Source, JobSource>`
- Produces: `JobSource.parseOpenState(raw: RawDetail): JobOpenState`
- Produces: `runCollect(deps: { store, sources: SourceRegistry, findRating? }, trigger, opts)`
- Produces: `createSourceRegistry(fetchImpl?): SourceRegistry` (`@job-finder/sources`)

- [ ] **Step 1: 섞인 큐가 각자 맞는 소스로 가는지 검사하는 테스트를 쓴다**

`packages/graph/test/fetch-detail.test.ts`에 추가한다:

```ts
test('섞인 큐에서 각 공고는 자기 source의 구현으로 간다', async () => {
  const seen: string[] = []
  const make = (id: Source): JobSource => ({
    id,
    parseSearchUrl: () => { throw new Error('unused') },
    async *listRefs() {},
    async fetchDetail(externalId) { seen.push(`${id}:${externalId}`); return { externalId, payload: {} } },
    normalize: () => ({
      annualFrom: null, annualTo: null, intro: null, requirements: null,
      mainTasks: null, preferredPoints: null, benefits: null, skillTags: [], raw: {},
    }),
    parseOpenState: () => ({ closed: false, dueTime: null }),
  })
  const store = new MemoryStore()
  await store.insertJobs([
    { source: 'wanted', externalId: 'w1', position: 'p', companyName: 'c',
      companyId: null, addressDistrict: null, addressFull: null, url: 'u', dueTime: null },
    { source: 'remember', externalId: 'r1', position: 'p', companyName: 'c',
      companyId: null, addressDistrict: null, addressFull: null, url: 'u', dueTime: null },
  ])
  const node = createFetchDetailNode({
    store, sources: { wanted: make('wanted'), remember: make('remember') },
  })
  for (const job of await store.listJobsNeedingDetail(10)) await node.run(job)

  expect(seen.sort()).toEqual(['remember:r1', 'wanted:w1'])
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/graph/test/fetch-detail.test.ts`
Expected: FAIL — `createFetchDetailNode`가 `sources`를 받지 않는다

- [ ] **Step 3: `JobSource` 인터페이스를 넓힌다**

`packages/sources/src/types.ts`:

```ts
import type { JobDetailFields, NewJob, SearchParams, Source } from '@job-finder/db'
import type { JobOpenState } from './wanted/normalize.js'

export interface JobSource {
  readonly id: Source
  parseSearchUrl(url: string): SearchParams
  listRefs(params: SearchParams): AsyncIterable<ExternalRef>
  fetchDetail(externalId: string): Promise<RawDetail>
  normalize(raw: RawDetail): JobDetailFields
  /**
   * 마감 여부는 소스마다 표기가 다르다 — Wanted는 'close', Remember는 'closed'다.
   * 자유 함수로 두면 recheck 노드가 어떤 소스의 payload든 Wanted 스키마로 파싱한다.
   */
  parseOpenState(raw: RawDetail): JobOpenState
}

/** 소스 id로 구현을 고르는 표. 노드는 처리 중인 행의 source로 여기서 꺼낸다. */
export type SourceRegistry = Record<Source, JobSource>
```

`JobOpenState`는 Wanted 전용이 아니므로 `packages/sources/src/types.ts`로 옮기고, `wanted/normalize.ts`는 거기서 import한다. `packages/sources/src/index.ts`의 재export도 따라 고친다.

- [ ] **Step 4: Wanted 소스에 `parseOpenState`를 단다**

`packages/sources/src/wanted/index.ts`의 반환 객체에 추가:

```ts
    normalize: normalizeWantedDetail,
    parseOpenState: parseJobOpenState,
```

`parseJobOpenState`를 `./normalize.js`에서 import한다.

- [ ] **Step 5: 레지스트리 팩토리를 만든다**

`packages/sources/src/index.ts`에 추가:

```ts
import type { SourceRegistry } from './types.js'
import { createWantedSource } from './wanted/index.js'

/** 운영에서 쓰는 소스 표. 호출부는 이 하나만 알면 된다. */
export function createSourceRegistry(fetchImpl: typeof fetch = fetch): SourceRegistry {
  return { wanted: createWantedSource(fetchImpl) }
}
```

Task 2에서 `Source`를 `'wanted'`로 남겨뒀으므로 이 객체는 지금 그대로 컴파일된다.
Task 6이 `Source`를 넓히면서 같은 커밋에서 `remember` 항목을 더한다.

- [ ] **Step 6: 세 노드가 레지스트리를 받게 바꾼다**

`discover.ts`:

```ts
export function createDiscoverNode(
  deps: { store: Store; sources: SourceRegistry },
): Node<Search, DiscoverResult> {
  return {
    name: 'discover',
    async run(search) {
      const source = deps.sources[search.source]
      // ... 이하 deps.source를 source로 바꾼다
```

`fetch-detail.ts`와 `recheck.ts`는 `const source = deps.sources[job.source]`로 같은 모양이다. `recheck.ts`는 `parseJobOpenState(raw)` 호출을 `source.parseOpenState(raw)`로 바꾸고, 자유 함수 import를 지운다.

- [ ] **Step 7: `runCollect`와 호출부를 맞춘다**

`packages/graph/src/pipelines/collect.ts`:

```ts
export async function runCollect(
  deps: { store: Store; sources: SourceRegistry; findRating?: FindRating },
  trigger: RunTrigger,
  opts: { detailLimit?: number; ratingLimit?: number; recheckLimit?: number } = {},
): Promise<CollectReport> {
  const { store, sources } = deps
```

세 `createXNode({ store, source })` 호출을 `{ store, sources }`로 바꾼다.

호출부 세 곳:

```ts
// apps/web/app/api/cron/collect/route.ts
const report = await runCollect({ store: getStore(), sources: createSourceRegistry() }, 'cron')

// apps/web/app/api/run/route.ts
runCollect({ store, sources: createSourceRegistry() }, 'manual')

// tools/backfill/src/index.ts
const sources = createSourceRegistry()
// ... runCollect({ store, sources }, 'cli', { detailLimit: DETAIL_BATCH })
```

- [ ] **Step 8: 테스트가 통과하는지 확인한다**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add packages apps tools
git commit -m "refactor(graph): 노드가 행의 source로 구현을 고르게 한다

discover/fetchDetail/recheck 세 노드가 단일 JobSource를 물고 있어
소스를 하나 더 붙일 수 없었다. 레지스트리에서 행마다 꺼내 쓴다.

소스별로 runNode를 나눠 돌리지 않는다 — listJobsNeedingDetail(50)이
Vercel 함수 시간 예산의 단위라, 소스로 쪼개면 한쪽이 굶는다.

parseOpenState를 자유 함수에서 인터페이스 메서드로 올린다. 마감 표기가
소스마다 다르다(Wanted 'close', Remember 'closed').

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Remember 클라이언트와 검색 URL 파싱

**Files:**
- Create: `packages/sources/src/remember/client.ts`
- Create: `packages/sources/src/remember/parse-url.ts`
- Create: `packages/sources/test/remember-parse-url.test.ts`
- Modify: `packages/sources/src/index.ts`

**Interfaces:**
- Consumes: `SourceHttpError` (Task 1), `RememberSearchParams` (Task 2)
- Produces: `RememberHttpError` (extends `SourceHttpError`), `postJson(url, body, fetchImpl?): Promise<unknown>`, `getRememberJson(url, fetchImpl?): Promise<unknown>`

> 이름이 `getJson`이 아니라 `getRememberJson`인 이유: `@job-finder/sources`의 배럴이
> Wanted의 `getJson`을 이미 export한다. 같은 이름을 쓰면 배럴에서 충돌한다.
- Produces: `parseRememberSearchUrl(url: string): RememberSearchParams`
- Produces: `buildRememberSearchBody(params: RememberSearchParams, page: { page: number; per: number }): Record<string, unknown>`
- Produces: `REMEMBER_API_BASE`, `REMEMBER_JOB_URL_BASE` 상수

- [ ] **Step 1: URL 파싱과 본문 생성 테스트를 쓴다**

`packages/sources/test/remember-parse-url.test.ts`:

```ts
import { expect, test } from 'vitest'
import { buildRememberSearchBody, parseRememberSearchUrl } from '../src/index.js'

// 실제 검색 페이지 URL이다. ?search=에 camelCase JSON이 통째로 들어간다.
const REAL_URL =
  'https://career.rememberapp.co.kr/job/postings?search=' +
  encodeURIComponent(JSON.stringify({
    jobCategoryNames: [{ level1: 'SW개발', level2: '프론트엔드' }],
    addresses: [['서울특별시'], ['경기도']],
    organizationType: 'without_headhunter',
    minExperience: 7,
  }))

test('search 파라미터의 JSON을 그대로 읽는다', () => {
  expect(parseRememberSearchUrl(REAL_URL)).toEqual({
    source: 'remember',
    jobCategoryNames: [{ level1: 'SW개발', level2: '프론트엔드' }],
    addresses: [['서울특별시'], ['경기도']],
    organizationType: 'without_headhunter',
    minExperience: 7,
  })
})

test('빠진 필드는 빈 값으로 채운다', () => {
  const url = 'https://career.rememberapp.co.kr/job/postings?search=' +
    encodeURIComponent(JSON.stringify({ minExperience: 3 }))
  expect(parseRememberSearchUrl(url)).toEqual({
    source: 'remember',
    jobCategoryNames: [],
    addresses: [],
    organizationType: null,
    minExperience: 3,
  })
})

test('search 파라미터가 없으면 던진다', () => {
  expect(() => parseRememberSearchUrl('https://career.rememberapp.co.kr/job/postings'))
    .toThrow(/search/)
})

// 이 변환표가 이 파일의 핵심이다. camelCase로 보내면 API가 400이 아니라
// 그 필터를 무시하고 200을 돌려준다(실측 122건 → 12,894건).
test('본문은 snake_case로 나간다', () => {
  const params = parseRememberSearchUrl(REAL_URL)
  expect(buildRememberSearchBody(params, { page: 2, per: 30 })).toEqual({
    search: {
      job_category_names: [{ level1: 'SW개발', level2: '프론트엔드' }],
      addresses: [['서울특별시'], ['경기도']],
      organization_type: 'without_headhunter',
      min_experience: 7,
    },
    page: 2,
    per: 30,
    sort: 'starts_at_desc',
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/sources/test/remember-parse-url.test.ts`
Expected: FAIL — not exported

- [ ] **Step 3: `parse-url.ts`를 만든다**

```ts
import type { RememberSearchParams } from '@job-finder/db'
import { z } from 'zod'

export const REMEMBER_API_BASE = 'https://career-api.rememberapp.co.kr'
export const REMEMBER_JOB_URL_BASE = 'https://career.rememberapp.co.kr/job/postings'

/** 화면의 정렬 드롭다운 '최신순'에 해당한다. 수집은 최신부터 보는 게 맞다. */
const SORT = 'starts_at_desc'

const searchJsonSchema = z.object({
  jobCategoryNames: z.array(z.object({ level1: z.string(), level2: z.string() })).optional(),
  addresses: z.array(z.array(z.string())).optional(),
  organizationType: z.string().nullable().optional(),
  minExperience: z.number().nullable().optional(),
})

export function parseRememberSearchUrl(input: string): RememberSearchParams {
  const raw = new URL(input).searchParams.get('search')
  if (!raw) throw new Error(`Remember 검색 URL이 아닙니다 (search 파라미터 필요): ${input}`)

  const parsed = searchJsonSchema.parse(JSON.parse(raw))
  return {
    source: 'remember',
    jobCategoryNames: parsed.jobCategoryNames ?? [],
    addresses: parsed.addresses ?? [],
    organizationType: parsed.organizationType ?? null,
    minExperience: parsed.minExperience ?? null,
  }
}

/**
 * 저장된 파라미터(camelCase, 페이지 URL과 같은 모양)를 API 본문(snake_case)으로 옮긴다.
 *
 * 자동 케이스 변환 함수를 쓰지 않는 이유: 이름이 틀리면 API가 400을 주지 않고
 * **그 필터만 조용히 무시한 채 200을 돌려준다**(실측에서 122건이 12,894건이 됐다).
 * 변환표가 한 곳에 명시적으로 적혀 있어야 눈으로 대조할 수 있다.
 */
export function buildRememberSearchBody(
  params: RememberSearchParams,
  page: { page: number; per: number },
): Record<string, unknown> {
  return {
    search: {
      job_category_names: params.jobCategoryNames,
      addresses: params.addresses,
      organization_type: params.organizationType,
      min_experience: params.minExperience,
    },
    page: page.page,
    per: page.per,
    sort: SORT,
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run packages/sources/test/remember-parse-url.test.ts`
Expected: PASS

- [ ] **Step 5: 클라이언트 테스트를 쓴다**

`packages/sources/test/remember-client.test.ts`:

```ts
import { expect, test } from 'vitest'
import { RememberHttpError, postJson } from '../src/index.js'

test('POST 본문을 JSON으로 싣고 결과를 돌려준다', async () => {
  let seen: RequestInit | undefined
  const fake: typeof fetch = async (_url, init) => {
    seen = init
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 })
  }
  expect(await postJson('https://x/y', { a: 1 }, fake)).toEqual({ ok: 1 })
  expect(seen!.method).toBe('POST')
  expect(JSON.parse(seen!.body as string)).toEqual({ a: 1 })
})

test('5xx는 retryable이다', async () => {
  const fake: typeof fetch = async () => new Response('', { status: 503 })
  await expect(postJson('https://x/y', {}, fake)).rejects.toSatisfy(
    (e: RememberHttpError) => e.status === 503 && e.retryable,
  )
})

test('404는 retryable이 아니다', async () => {
  const fake: typeof fetch = async () => new Response('', { status: 404 })
  await expect(postJson('https://x/y', {}, fake)).rejects.toSatisfy(
    (e: RememberHttpError) => e.status === 404 && !e.retryable,
  )
})

// 2xx인데 JSON이 아닌 본문(봇 차단 인터스티셜 등)은 영구 실패보다 일시적 차단일
// 가능성이 높다 — Wanted 클라이언트와 같은 판단이다.
test('2xx인데 JSON이 아니면 502로 분류한다', async () => {
  const fake: typeof fetch = async () => new Response('<html>', { status: 200 })
  await expect(postJson('https://x/y', {}, fake)).rejects.toSatisfy(
    (e: RememberHttpError) => e.status === 502 && e.retryable,
  )
})
```

- [ ] **Step 6: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/sources/test/remember-client.test.ts`
Expected: FAIL — not exported

- [ ] **Step 7: `client.ts`를 만든다**

`wanted/client.ts`와 같은 규약을 따른다 — 타임아웃 15초, abort는 status 0, 2xx 비JSON은 502.

```ts
import { SourceHttpError } from '../http.js'

const ORIGIN = 'https://career.rememberapp.co.kr'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36'

/** wanted/client.ts와 같은 값·같은 이유 — undici 기본값(300초)이면 Vercel 함수가
 * maxDuration(60초)에 먼저 죽어 실패 기록이 남지 않는다. */
const REQUEST_TIMEOUT_MS = 15_000

export class RememberHttpError extends SourceHttpError {
  constructor(status: number, message: string) {
    super(status, message)
    this.name = 'RememberHttpError'
  }
}

async function request(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetchImpl(url, {
      ...init,
      headers: {
        'User-Agent': UA,
        Origin: ORIGIN,
        Referer: `${ORIGIN}/`,
        Accept: 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new RememberHttpError(0, `네트워크 실패: ${String(cause)}`)
  }
  if (!res.ok) {
    throw new RememberHttpError(res.status, `${res.status} ${res.statusText} — ${url}`)
  }
  try {
    return await res.json()
  } catch (cause) {
    throw new RememberHttpError(502, `JSON 파싱 실패 (HTTP ${res.status}) — ${url}: ${String(cause)}`)
  }
}

export function postJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, fetchImpl)
}

export function getRememberJson(url: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  return request(url, { method: 'GET' }, fetchImpl)
}
```

`packages/sources/src/index.ts`에 재export를 추가한다:

```ts
export {
  REMEMBER_API_BASE, REMEMBER_JOB_URL_BASE,
  buildRememberSearchBody, parseRememberSearchUrl,
} from './remember/parse-url.js'
export { RememberHttpError, getRememberJson, postJson } from './remember/client.js'
```

- [ ] **Step 8: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run packages/sources/ && pnpm typecheck`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add packages/sources
git commit -m "feat(sources): Remember HTTP 클라이언트와 검색 URL 파싱

목록이 GET 쿼리스트링이 아니라 POST 본문이라 postJson이 필요하다.

케이스 자동 변환을 쓰지 않고 변환표를 명시한다 — 이름이 틀리면 API가
400이 아니라 그 필터만 무시하고 200을 준다(실측 122건 → 12,894건).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Remember 응답 정규화

**Files:**
- Create: `packages/sources/test/fixtures/remember-list.json`
- Create: `packages/sources/test/fixtures/remember-detail.json`
- Create: `packages/sources/src/remember/normalize.ts`
- Create: `packages/sources/test/remember-normalize.test.ts`
- Modify: `packages/sources/src/index.ts`

**Interfaces:**
- Consumes: `normalizeDueTime` (Task 1), `REMEMBER_JOB_URL_BASE` (Task 4)
- Produces: `parseRememberListPage(payload): { refs: ExternalRef[]; page: number; totalPages: number; ignoredFilters: string[] }`
- Produces: `normalizeRememberDetail(raw: RawDetail): JobDetailFields`
- Produces: `parseRememberOpenState(raw: RawDetail): JobOpenState`

- [ ] **Step 1: 실제 응답을 픽스처로 저장한다**

```bash
mkdir -p packages/sources/test/fixtures

curl -s -X POST 'https://career-api.rememberapp.co.kr/job_postings/search' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://career.rememberapp.co.kr' \
  -d '{"search":{"job_category_names":[{"level1":"SW개발","level2":"프론트엔드"}],"addresses":[["서울특별시"],["경기도"]],"organization_type":"without_headhunter","min_experience":7},"page":1,"per":2,"sort":"starts_at_desc"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))' \
  > packages/sources/test/fixtures/remember-list.json

curl -s -H 'Origin: https://career.rememberapp.co.kr' \
  'https://career-api.rememberapp.co.kr/job_postings/341688' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))' \
  > packages/sources/test/fixtures/remember-detail.json
```

저장 후 `meta.logger_info.query_meta_data.search`에 `min_experience: 7`과 `organization_type: "without_headhunter"`가 들어 있는지 눈으로 확인한다. `null`이면 필터가 무시된 응답이라 픽스처로 쓸 수 없다.

`341688`이 내려가 404가 나면, list 픽스처의 첫 `data[0].id`를 써라.

- [ ] **Step 2: 정규화 테스트를 쓴다**

`packages/sources/test/remember-normalize.test.ts`:

```ts
import { expect, test } from 'vitest'
import listFixture from './fixtures/remember-list.json' with { type: 'json' }
import detailFixture from './fixtures/remember-detail.json' with { type: 'json' }
import {
  normalizeRememberDetail, parseRememberListPage, parseRememberOpenState,
} from '../src/index.js'

test('목록에서 공고 참조를 뽑는다', () => {
  const { refs, page, totalPages } = parseRememberListPage(listFixture)
  expect(refs.length).toBeGreaterThan(0)
  expect(page).toBe(1)
  expect(totalPages).toBeGreaterThan(1)

  const first = refs[0]!
  const raw = (listFixture as any).data[0]
  expect(first.externalId).toBe(String(raw.id))
  expect(first.job.position).toBe(raw.title)
  expect(first.job.companyName).toBe(raw.organization.name)
  expect(first.job.companyId).toBe(raw.organization.company_id)
  expect(first.job.url).toBe(`https://career.rememberapp.co.kr/job/postings/${raw.id}`)
})

// 이 검사가 이 소스의 안전장치다. 서버가 해석한 필터가 메타로 그대로 돌아오는데,
// 우리가 보낸 값이 null로 돌아왔다면 이름이 틀려 필터가 통째로 무시된 것이다.
test('서버가 무시한 필터를 찾아낸다', () => {
  const ignored = parseRememberListPage({
    data: [],
    meta: {
      page: 1, total_pages: 1,
      logger_info: { query_meta_data: { search: {
        job_category_ids: [], organization_type: null, min_experience: null, addresses: null,
      } } },
    },
  }).ignoredFilters
  expect(ignored).toContain('organization_type')
  expect(ignored).toContain('min_experience')
})

test('정상 응답에서는 무시된 필터가 없다', () => {
  expect(parseRememberListPage(listFixture).ignoredFilters).toEqual([])
})

test('상세를 채점 입력 필드로 옮긴다', () => {
  const raw = { externalId: '1', payload: detailFixture }
  const fields = normalizeRememberDetail(raw)
  const j = (detailFixture as any).data
  expect(fields.mainTasks).toBe(j.job_description)
  expect(fields.requirements).toBe(j.qualifications)
  expect(fields.intro).toBe(j.introduction)
  expect(fields.preferredPoints).toBe(j.preferred_qualifications)
  expect(fields.benefits).toBe(j.additional_information)
  // Remember에는 기술 태그가 없다. job_categories는 직무 분류지 스택이 아니라
  // 채점 프롬프트에 넣지 않는다.
  expect(fields.skillTags).toEqual([])
  expect(fields.raw).toBe(detailFixture)
})

// 상한 없음을 null이 아니라 100으로 저장한다 — formatExperience의 "N년 이상"
// 분기가 그 센티널을 쓰기 때문이다. null로 두면 화면에 경력이 안 나온다.
test('경력 상한 없음은 100으로 맞춘다', () => {
  const fields = normalizeRememberDetail({
    externalId: '1',
    payload: { data: { id: 1, status: 'published', min_experience: 7, max_experience: null } },
  })
  expect(fields.annualFrom).toBe(7)
  expect(fields.annualTo).toBe(100)
})

test('경력 하한 없음은 0(신입 포함)으로 맞춘다', () => {
  const fields = normalizeRememberDetail({
    externalId: '1',
    payload: { data: { id: 1, status: 'published', min_experience: null, max_experience: 5 } },
  })
  expect(fields.annualFrom).toBe(0)
  expect(fields.annualTo).toBe(5)
})

// Wanted는 'close', Remember는 'closed'다.
test.each([
  ['published', false],
  ['closed', true],
  ['draft', false],      // 모르는 값은 열린 것으로 둔다
])('status %s의 closed는 %s다', (status, closed) => {
  const state = parseRememberOpenState({
    externalId: '1', payload: { data: { id: 1, status, ends_at: null } },
  })
  expect(state.closed).toBe(closed)
})

test('마감일은 date 컬럼에 맞게 앞 10자만 남긴다', () => {
  const state = parseRememberOpenState({
    externalId: '1',
    payload: { data: { id: 1, status: 'published', ends_at: '2024-11-19T23:59:59.000+09:00' } },
  })
  expect(state.dueTime).toBe('2024-11-19')
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/sources/test/remember-normalize.test.ts`
Expected: FAIL — not exported

- [ ] **Step 4: `normalize.ts`를 만든다**

```ts
import type { JobDetailFields } from '@job-finder/db'
import { z } from 'zod'
import { normalizeDueTime } from '../date.js'
import type { ExternalRef, JobOpenState, RawDetail } from '../types.js'
import { REMEMBER_JOB_URL_BASE } from './parse-url.js'

/** formatExperience가 "N년 이상"으로 읽는 센티널. Wanted가 쓰는 값과 같아야 한다. */
const NO_UPPER_BOUND = 100

const listItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  organization: z.object({
    name: z.string(),
    company_id: z.number().nullable().optional(),
  }),
  normalized_address: z.object({
    level1: z.string().nullable().optional(),
    level2: z.string().nullable().optional(),
  }).nullable().optional(),
  addresses: z.array(z.object({
    address_level1: z.string().nullable().optional(),
    address_level2: z.string().nullable().optional(),
  })).nullable().optional(),
  ends_at: z.string().nullable().optional(),
})

/**
 * 서버가 실제로 해석한 필터가 여기로 그대로 돌아온다. 우리가 보낸 이름이 틀리면
 * 400이 아니라 이 자리에 null이 오고 결과는 필터 없는 전량이 된다.
 */
const echoSchema = z.object({
  organization_type: z.unknown().nullable().optional(),
  min_experience: z.unknown().nullable().optional(),
  addresses: z.unknown().nullable().optional(),
  job_category_ids: z.array(z.unknown()).nullable().optional(),
}).passthrough()

const listPageSchema = z.object({
  data: z.array(listItemSchema),
  meta: z.object({
    page: z.number(),
    total_pages: z.number(),
    logger_info: z.object({
      query_meta_data: z.object({ search: echoSchema }),
    }).optional(),
  }),
})

const detailSchema = z.object({
  data: z.object({
    id: z.number(),
    status: z.string().nullable().optional(),
    ends_at: z.string().nullable().optional(),
    min_experience: z.number().nullable().optional(),
    max_experience: z.number().nullable().optional(),
    introduction: z.string().nullable().optional(),
    qualifications: z.string().nullable().optional(),
    job_description: z.string().nullable().optional(),
    preferred_qualifications: z.string().nullable().optional(),
    additional_information: z.string().nullable().optional(),
  }),
})

function addressFull(item: z.infer<typeof listItemSchema>): string | null {
  const a = item.addresses?.[0]
  if (!a) return null
  return [a.address_level1, a.address_level2].filter(Boolean).join(' ') || null
}

export interface RememberListPage {
  refs: ExternalRef[]
  page: number
  totalPages: number
  /** 서버가 무시한 필터 이름. 비어 있지 않으면 수집을 진행하면 안 된다. */
  ignoredFilters: string[]
}

export function parseRememberListPage(payload: unknown): RememberListPage {
  const parsed = listPageSchema.parse(payload)
  const echo = parsed.meta.logger_info?.query_meta_data.search

  const ignoredFilters: string[] = []
  if (echo) {
    // job_category_names는 서버가 id로 바꿔 돌려주므로(job_category_ids) 이름이 아니라
    // id 배열이 비었는지로 본다. 나머지는 보낸 값이 그대로 돌아온다.
    if (echo.organization_type == null) ignoredFilters.push('organization_type')
    if (echo.min_experience == null) ignoredFilters.push('min_experience')
    if (echo.addresses == null) ignoredFilters.push('addresses')
    if (!echo.job_category_ids?.length) ignoredFilters.push('job_category_names')
  }

  const refs = parsed.data.map((item): ExternalRef => ({
    externalId: String(item.id),
    job: {
      externalId: String(item.id),
      position: item.title,
      companyName: item.organization.name,
      companyId: item.organization.company_id ?? null,
      addressDistrict: item.normalized_address?.level2 ?? null,
      addressFull: addressFull(item),
      url: `${REMEMBER_JOB_URL_BASE}/${item.id}`,
      dueTime: normalizeDueTime(item.ends_at),
    },
  }))

  return { refs, page: parsed.meta.page, totalPages: parsed.meta.total_pages, ignoredFilters }
}

export function normalizeRememberDetail(raw: RawDetail): JobDetailFields {
  const j = detailSchema.parse(raw.payload).data
  return {
    // 상한 없음(null)을 Wanted와 같은 센티널로 맞춘다 — 그래야 formatExperience와
    // 그 테스트가 두 소스를 한 규칙으로 덮는다.
    annualFrom: j.min_experience ?? 0,
    annualTo: j.max_experience ?? NO_UPPER_BOUND,
    intro: j.introduction ?? null,
    requirements: j.qualifications ?? null,
    mainTasks: j.job_description ?? null,
    preferredPoints: j.preferred_qualifications ?? null,
    benefits: j.additional_information ?? null,
    // Remember에는 기술 태그가 없다. job_categories는 직무 분류지 스택이 아니라,
    // 채점 프롬프트에 스택으로 넘기면 루틴이 잘못 읽는다. 스택은 qualifications 본문에 있다.
    skillTags: [],
    raw: raw.payload,
  }
}

/** Wanted는 'close', Remember는 'closed'다. 모르는 값은 열린 것으로 둔다. */
export function parseRememberOpenState(raw: RawDetail): JobOpenState {
  const j = detailSchema.parse(raw.payload).data
  return { closed: j.status === 'closed', dueTime: normalizeDueTime(j.ends_at) }
}
```

`packages/sources/src/index.ts`에 재export를 추가한다.

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run packages/sources/ && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/sources
git commit -m "feat(sources): Remember 응답 정규화와 실제 응답 픽스처

경력 상한 없음(null)을 Wanted와 같은 100 센티널로 맞춘다 —
formatExperience가 그 값으로 '경력 N년 이상'을 만든다.

skillTags는 빈 배열로 둔다. job_categories는 직무 분류지 기술 스택이
아니라, 채점 프롬프트에 스택으로 넘기면 루틴이 잘못 읽는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `createRememberSource`와 레지스트리 등록

**Files:**
- Create: `packages/sources/src/remember/index.ts`
- Create: `packages/sources/test/remember-source.test.ts`
- Modify: `packages/sources/src/index.ts`
- Modify: `apps/web/app/api/cron/collect/route.ts`, `apps/web/app/api/run/route.ts`, `tools/backfill/src/index.ts`

**Interfaces:**
- Consumes: Task 4·5 전부, `SourceRegistry` (Task 3)
- Produces: `Source = 'wanted' | 'remember'` (Task 2에서 미뤄둔 확장)
- Produces: `createRememberSource(fetchImpl?): JobSource`
- Produces: `createSourceRegistry(fetchImpl?): SourceRegistry` — `{ wanted, remember }`

- [ ] **Step 1: 페이징과 필터 검사 테스트를 쓴다**

`packages/sources/test/remember-source.test.ts`:

```ts
import { expect, test } from 'vitest'
import type { RememberSearchParams } from '@job-finder/db'
import { createRememberSource } from '../src/index.js'

const PARAMS: RememberSearchParams = {
  source: 'remember',
  jobCategoryNames: [{ level1: 'SW개발', level2: '프론트엔드' }],
  addresses: [['서울특별시']],
  organizationType: 'without_headhunter',
  minExperience: 7,
}

function page(n: number, totalPages: number, ids: number[]) {
  return {
    data: ids.map((id) => ({
      id, title: `t${id}`, organization: { name: 'c', company_id: 1 },
      normalized_address: { level1: '서울', level2: '강남구' },
      addresses: [{ address_level1: '서울특별시', address_level2: '강남구' }],
      ends_at: null,
    })),
    meta: {
      page: n, total_pages: totalPages,
      logger_info: { query_meta_data: { search: {
        job_category_ids: [311], organization_type: 'without_headhunter',
        min_experience: 7, addresses: [['서울특별시']],
      } } },
    },
  }
}

test('total_pages까지 돌면서 모든 공고를 낸다', async () => {
  const pages = [page(1, 2, [1, 2]), page(2, 2, [3])]
  let calls = 0
  const fake: typeof fetch = async () =>
    new Response(JSON.stringify(pages[calls++]!), { status: 200 })

  const source = createRememberSource(fake)
  const ids: string[] = []
  for await (const ref of source.listRefs(PARAMS)) ids.push(ref.externalId)

  expect(ids).toEqual(['1', '2', '3'])
  expect(calls).toBe(2)
})

// 필터가 무시되면 전량(실측 12,894건)이 쏟아진다. 조용히 수집하면 안 된다.
test('서버가 필터를 무시하면 던진다', async () => {
  const broken = page(1, 400, [1])
  broken.meta.logger_info.query_meta_data.search.min_experience = null as never

  const fake: typeof fetch = async () => new Response(JSON.stringify(broken), { status: 200 })
  const source = createRememberSource(fake)

  await expect(async () => {
    for await (const _ of source.listRefs(PARAMS)) { /* 소비만 한다 */ }
  }).rejects.toThrow(/min_experience/)
})

test('상세 URL은 id로 만든다', async () => {
  let seen = ''
  const fake: typeof fetch = async (url) => {
    seen = String(url)
    return new Response(JSON.stringify({ data: { id: 7, status: 'published' } }), { status: 200 })
  }
  await createRememberSource(fake).fetchDetail('7')
  expect(seen).toBe('https://career-api.rememberapp.co.kr/job_postings/7')
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/sources/test/remember-source.test.ts`
Expected: FAIL — `createRememberSource` is not exported

- [ ] **Step 3: `remember/index.ts`를 만든다**

```ts
import type { SearchParams } from '@job-finder/db'
import type { ExternalRef, JobSource, RawDetail } from '../types.js'
import { RememberHttpError, getRememberJson, postJson } from './client.js'
import {
  normalizeRememberDetail, parseRememberListPage, parseRememberOpenState,
} from './normalize.js'
import {
  REMEMBER_API_BASE, buildRememberSearchBody, parseRememberSearchUrl,
} from './parse-url.js'

/** 화면 기본값과 같다. 122건이면 5페이지다. */
const PAGE_SIZE = 30
/** 무한 루프 방지. total_pages를 믿되 상한은 둔다 — 30 × 50 = 1500건. */
const MAX_PAGES = 50

export function createRememberSource(fetchImpl: typeof fetch = fetch): JobSource {
  return {
    id: 'remember',
    parseSearchUrl: parseRememberSearchUrl,

    async *listRefs(params: SearchParams): AsyncIterable<ExternalRef> {
      if (params.source !== 'remember') {
        throw new Error(`remember 소스에 ${params.source} 파라미터가 왔습니다`)
      }
      for (let page = 1; page <= MAX_PAGES; page++) {
        const payload = await postJson(
          `${REMEMBER_API_BASE}/job_postings/search`,
          buildRememberSearchBody(params, { page, per: PAGE_SIZE }),
          fetchImpl,
        )
        const parsed = parseRememberListPage(payload)

        // 필터 이름이 틀리면 API는 400이 아니라 그 필터를 무시하고 200을 준다.
        // 그대로 두면 조건에 맞지 않는 전량(실측 12,894건)이 수집된다.
        // 422처럼 영구 실패로 분류한다 — 재시도해도 같은 본문이라 같은 결과다.
        if (parsed.ignoredFilters.length > 0) {
          throw new RememberHttpError(
            422,
            `Remember가 필터를 무시했습니다: ${parsed.ignoredFilters.join(', ')} ` +
            '(본문 키가 snake_case인지 확인하라)',
          )
        }

        for (const ref of parsed.refs) yield ref
        if (parsed.page >= parsed.totalPages) return
      }
    },

    async fetchDetail(externalId: string): Promise<RawDetail> {
      const payload = await getRememberJson(
        `${REMEMBER_API_BASE}/job_postings/${externalId}`,
        fetchImpl,
      )
      return { externalId, payload }
    },

    normalize: normalizeRememberDetail,
    parseOpenState: parseRememberOpenState,
  }
}
```

- [ ] **Step 4: `Source`를 넓히고 레지스트리를 완성한다**

먼저 `packages/db/src/types.ts` 맨 위를 바꾼다 (Task 2에서 미뤄둔 한 줄):

```ts
export type Source = 'wanted' | 'remember'
```

그다음 `packages/sources/src/index.ts`:

```ts
export { createRememberSource } from './remember/index.js'

/** 운영에서 쓰는 소스 표. 호출부는 이 하나만 알면 된다. */
export function createSourceRegistry(fetchImpl: typeof fetch = fetch): SourceRegistry {
  return {
    wanted: createWantedSource(fetchImpl),
    remember: createRememberSource(fetchImpl),
  }
}
```

호출부 세 곳(cron collect · run · backfill)은 Task 3에서 이미 `createSourceRegistry()`를
쓰고 있으므로 손대지 않는다 — 표에 항목이 하나 는 것만으로 두 소스가 다 돈다.
그게 이 배선이 옳다는 증거다.

- [ ] **Step 5: 백필 CLI가 두 소스 URL을 다 받게 한다**

`tools/backfill/src/index.ts`의 `--url` 분기:

```ts
    const url = process.argv[urlArg + 1]
    if (!url) throw new Error('--url 뒤에 검색 URL이 필요합니다')
    // 어느 사이트의 URL인지는 호스트로 정한다. 사람이 --source를 타이핑하게 하면
    // params 모양과 어긋난 행이 만들어질 수 있다.
    const params = url.includes('rememberapp.co.kr')
      ? parseRememberSearchUrl(url)
      : parseWantedSearchUrl(url)
    console.log('검색 등록:', JSON.stringify(params))
    console.log(
      'Supabase SQL Editor에서 실행하세요:\n' +
      `insert into searches (source, url, params) values (` +
      `${quote(params.source)}, ${quote(url)}, ${quote(JSON.stringify(params))}::jsonb);`,
    )
    return
```

- [ ] **Step 6: 테스트와 타입체크**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add packages apps tools
git commit -m "feat(sources): Remember 소스를 레지스트리에 등록한다

listRefs는 첫 페이지에서 서버의 필터 에코를 검사해, 무시된 필터가 있으면
422로 끊는다 — 그냥 두면 조건에 맞지 않는 전량이 조용히 수집된다.

백필 CLI는 URL 호스트로 소스를 정한다. 사람이 --source를 따로 치게 하면
params 모양과 어긋난 행이 만들어질 수 있다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `duplicate_of` 스키마와 Store

**Files:**
- Create: `packages/db/migrations/0011_jobs_duplicate_of.sql`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/db/src/store.ts`
- Modify: `packages/db/src/memory-store.ts`
- Modify: `packages/db/src/supabase-store.ts`
- Modify: `packages/db/test/store-contract.ts`

**Interfaces:**
- Produces: `Store.listDedupIndex(): Promise<DedupCandidate[]>`
- Produces: `Store.markDuplicates(pairs: Array<{ jobId: string; duplicateOf: string }>): Promise<void>`
- Produces: `DedupCandidate = Pick<Job, 'id' | 'source' | 'companyName' | 'position'>`
- Produces: `DashboardFilters.duplicatesOnly?: boolean`

- [ ] **Step 1: 마이그레이션 파일을 만든다**

`packages/db/migrations/0011_jobs_duplicate_of.sql`:

```sql
-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `if not exists`라 재실행해도 안전하다.
--
-- 같은 공고가 Wanted와 Remember 양쪽에 올라오면 jobs에 두 행이 생기고, 둘 다
-- 채점되어 하루 top 3 메일 슬롯을 둘 차지한다. 나중에 들어온 쪽에 원본을 가리키는
-- 포인터를 달아 기본 목록·채점·발송에서 빼되, 행은 지우지 않는다.
--
-- 왜 hidden을 재사용하지 않나: hidden은 이미 쓰는 주체가 셋이다(사람의 제외,
-- 0008의 저점수 자동 제외, recordJobRecheck의 마감 자동 제외). 네 번째로 중복까지
-- 끼워 넣으면 "왜 안 보이는가"를 되짚을 수 없고 되돌리기의 뜻도 모호해진다.
--
-- 왜 수집 시 버리지 않나: 대기업은 같은 회사·같은 제목으로 다른 팀 공고를 동시에
-- 올린다. 휴리스틱이 이걸 중복으로 보면 DB에 흔적조차 없어 놓친 줄도 모른다.
-- Blind 커버리지를 표본 73%에서 실측 56%로 바로잡을 수 있었던 것도 확정 못 한
-- 회사를 행으로 남겼기 때문이다.
alter table jobs
  add column if not exists duplicate_of uuid references jobs(id) on delete set null;

-- listDedupIndex("중복 아니고 제외 안 된 것 중 오래된 순")를 받는다.
-- jobs_recheck_idx와 같은 모양의 부분 인덱스다.
create index if not exists jobs_dedup_idx
  on jobs (first_seen_at)
  where duplicate_of is null and hidden = false;

-- 중복은 채점하지 않는다. 뷰를 다시 만들어야 하는데, security_invoker를 빠뜨리면
-- 뷰가 소유자 권한(BYPASSRLS)으로 돌아 anon이 이 뷰로 jobs를 전부 읽게 된다.
-- 0001의 주석이 경고한 그 구멍이다 — 아래 옵션을 지우지 마라.
drop view if exists jobs_needing_score;
create view jobs_needing_score
  with (security_invoker = true) as
  select j.* from jobs j
  left join scores s on s.job_id = j.id
  where j.detail_status = 'ok'
    and j.duplicate_of is null
    and (s.job_id is null or (s.status = 'failed' and s.attempts < 3));
```

- [ ] **Step 2: 계약 테스트를 쓴다**

`packages/db/test/store-contract.ts`에 추가한다. 기존 시드 헬퍼와 `test`/`expect` import 방식을 따른다:

```ts
  test('중복 인덱스는 중복 아니고 제외 안 된 행만, 오래된 순으로 준다', async () => {
    const store = await makeStore()
    const [a, b, c] = await store.insertJobs([
      newJob({ source: 'wanted', externalId: 'a', companyName: '루닛', position: 'FE' }),
      newJob({ source: 'remember', externalId: 'b', companyName: '루닛', position: 'FE' }),
      newJob({ source: 'wanted', externalId: 'c', companyName: '토스', position: 'BE' }),
    ])
    await store.setJobHidden(c!.id, true)
    await store.markDuplicates([{ jobId: b!.id, duplicateOf: a!.id }])

    const index = await store.listDedupIndex()
    expect(index.map((r) => r.id)).toEqual([a!.id])
  })

  // 마감돼 숨겨진 옛 행이 후보로 남으면, 새 external_id로 다시 올라온 공고가
  // 그 옛 행의 중복으로 찍혀 영원히 채점되지 않는다. recheck가 세운 보장이 깨진다.
  test('중복으로 표시된 공고는 채점 대기에서 빠진다', async () => {
    const store = await makeStore()
    const [a, b] = await store.insertJobs([
      newJob({ source: 'wanted', externalId: 'a' }),
      newJob({ source: 'remember', externalId: 'b' }),
    ])
    await store.saveJobDetail(a!.id, detailFields())
    await store.saveJobDetail(b!.id, detailFields())
    await store.markDuplicates([{ jobId: b!.id, duplicateOf: a!.id }])

    const needing = await store.listJobsNeedingScore(10)
    expect(needing.map((j) => j.id)).toEqual([a!.id])
  })
```

> `newJob`·`detailFields` 헬퍼가 파일에 없으면 기존 테스트가 쓰는 인라인 객체 형태를 그대로 따라 써라 — 헬퍼를 새로 만들지 마라.

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/db/test/memory-store.test.ts`
Expected: FAIL — `listDedupIndex` is not a function

- [ ] **Step 4: 타입과 인터페이스를 넓힌다**

`packages/db/src/types.ts`:

```ts
/** 중복 판정에 필요한 최소 컬럼. 전량을 받아 JS에서 맞추므로 좁게 잡는다. */
export type DedupCandidate = Pick<Job, 'id' | 'source' | 'companyName' | 'position'>
```

`Job` 인터페이스에 추가:

```ts
  /** 이 공고가 중복인 경우 원본 job id. null이면 중복이 아니다. */
  duplicateOf: string | null
```

`DashboardFilters`에 추가:

```ts
  /**
   * true면 중복으로 표시된 공고만, 아니면 중복이 아닌 것만 준다.
   * hiddenOnly와 같은 배타 버킷이라 한 페이지에 두 값이 섞이지 않는다.
   */
  duplicatesOnly?: boolean
```

`packages/db/src/store.ts`:

```ts
  // ── 교차 중복
  /**
   * 중복 판정 후보. duplicate_of가 null이고 hidden이 아닌 행만 오래된 순으로 준다.
   *
   * hidden을 빼는 것이 중요하다 — recheck는 "같은 공고가 다시 올라오면 소스가 새
   * external_id를 주므로 새 행으로 정상 수집·채점된다"를 보장한다. 마감돼 숨겨진
   * 행을 후보로 두면 재등록분이 그 옛 행의 중복으로 찍혀 영원히 채점되지 않는다.
   */
  listDedupIndex(): Promise<DedupCandidate[]>
  /** 새로 만든 행을 기존 행의 중복으로 표시한다. */
  markDuplicates(pairs: Array<{ jobId: string; duplicateOf: string }>): Promise<void>
```

- [ ] **Step 5: 두 구현을 맞춘다**

`packages/db/src/memory-store.ts` — `insertJobs`의 `Job` 리터럴에 `duplicateOf: null`을 추가하고:

```ts
  async listDedupIndex(): Promise<DedupCandidate[]> {
    return [...this.jobs.values()]
      .filter((j) => j.duplicateOf === null && !j.hidden)
      .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id))
      .map((j) => ({ id: j.id, source: j.source, companyName: j.companyName, position: j.position }))
  }

  async markDuplicates(pairs: Array<{ jobId: string; duplicateOf: string }>) {
    for (const { jobId, duplicateOf } of pairs) {
      const job = this.jobs.get(jobId)
      if (!job) continue
      this.jobs.set(jobId, { ...job, duplicateOf })
    }
  }
```

`listJobsNeedingScore`와 `listNotifyCandidates`, `listNotifyPending`, `listDashboardJobs`의 필터에 `duplicateOf` 조건을 넣는다.

`packages/db/src/supabase-store.ts` — `JobRow`에 `duplicate_of: string | null`을 추가하고 매핑에 `duplicateOf: row.duplicate_of`를 넣는다:

```ts
    async listDedupIndex(): Promise<DedupCandidate[]> {
      // 전량을 받아 JS에서 맞춘다. listCompaniesNeedingRating과 같은 방식으로,
      // 수백 행 규모라 페이로드가 작고 정규화 규칙이 SQL로 새어 나가지 않는다.
      const rows = unwrap<Array<{
        id: string; source: Source; company_name: string; position: string
      }>>(
        await db.from('jobs').select('id, source, company_name, position')
          .is('duplicate_of', null).eq('hidden', false)
          .order('first_seen_at', { ascending: true }).order('id', { ascending: true }),
      )
      return rows.map((r) => ({
        id: r.id, source: r.source, companyName: r.company_name, position: r.position,
      }))
    },

    async markDuplicates(pairs: Array<{ jobId: string; duplicateOf: string }>) {
      // 건별 update다. 한 실행에서 나오는 중복은 많아야 몇 건이고,
      // PostgREST의 배치 update는 같은 값으로만 가능해 쌍마다 다른 값을 못 싣는다.
      for (const { jobId, duplicateOf } of pairs) {
        if (!isUuid(jobId) || !isUuid(duplicateOf)) continue
        const { error } = await db.from('jobs')
          .update({ duplicate_of: duplicateOf }).eq('id', jobId)
        if (error) throw new Error(error.message)
      }
    },
```

`listNotifyCandidates`·`listNotifyPending`·`listDashboardJobs`의 질의에 `.is('jobs.duplicate_of', null)`(embed 경로는 파일의 기존 표기를 따른다)를 더한다. `listDashboardJobs`는 `hiddenOnly`가 쓰는 버킷 방식과 같게 `duplicatesOnly`를 처리한다.

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add packages/db
git commit -m "feat(db): 교차 중복을 duplicate_of 포인터로 표시한다

hidden을 재사용하지 않는다 — 이미 쓰는 주체가 셋이라(사람·저점수·마감)
네 번째가 끼면 '왜 안 보이는가'를 되짚을 수 없다.

listDedupIndex가 hidden을 빼는 것이 중요하다. recheck는 재등록분이 새
external_id로 정상 채점된다고 보장하는데, 마감돼 숨겨진 옛 행을 후보로
두면 재등록분이 그 중복으로 찍혀 그 보장이 깨진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 중복 판정과 discover 연결

**Files:**
- Create: `packages/graph/src/core/dedup.ts`
- Create: `packages/graph/test/dedup.test.ts`
- Modify: `packages/graph/src/nodes/discover.ts`
- Modify: `packages/graph/test/discover.test.ts`
- Modify: `packages/graph/src/index.ts`

**Interfaces:**
- Consumes: `DedupCandidate`, `Store.listDedupIndex`, `Store.markDuplicates` (Task 7)
- Produces: `normalizeCompany(name: string): string`, `normalizePosition(title: string): string`
- Produces: `findDuplicate(candidate: DedupCandidate, index: DedupCandidate[]): DedupCandidate | null`
- Produces: `DiscoverResult.duplicates: number`

- [ ] **Step 1: 판정 테스트를 쓴다**

`packages/graph/test/dedup.test.ts`:

```ts
import { expect, test } from 'vitest'
import type { DedupCandidate } from '@job-finder/db'
import { findDuplicate, normalizeCompany, normalizePosition } from '../src/index.js'

const c = (
  id: string, source: 'wanted' | 'remember', companyName: string, position: string,
): DedupCandidate => ({ id, source, companyName, position })

test('법인격 표기를 벗긴다', () => {
  expect(normalizeCompany('(주)루닛')).toBe('루닛')
  expect(normalizeCompany('주식회사 노써치')).toBe('노써치')
  expect(normalizeCompany('㈜토스')).toBe('토스')
  expect(normalizeCompany('Lunit Inc.')).toBe('lunit')
})

test('직무명에서 대괄호 블록과 공백을 지운다', () => {
  expect(normalizePosition('[루닛]Senior Full Stack Engineer · AI Platform'))
    .toBe('seniorfullstackengineer·aiplatform')
  expect(normalizePosition('Senior Full Stack Engineer')).toBe('seniorfullstackengineer')
})

// Remember는 제목에 [회사명] 접두와 · 팀명 접미를 붙이는 경우가 많다.
// 완전 일치를 요구하면 이 실측 케이스를 놓친다.
test('접두·접미가 붙은 같은 공고를 찾아낸다', () => {
  const index = [c('a', 'wanted', '루닛', 'Senior Full Stack Engineer')]
  const found = findDuplicate(
    c('b', 'remember', '(주)루닛', '[루닛]Senior Full Stack Engineer · AI Platform'),
    index,
  )
  expect(found?.id).toBe('a')
})

// 짧은 제목은 아무거나 빨아들인다 — 정규화 후 8자 미만이면 판정하지 않는다.
test('짧은 직무명은 중복으로 보지 않는다', () => {
  const index = [c('a', 'wanted', '토스', '개발자')]
  expect(findDuplicate(c('b', 'remember', '토스', '프론트엔드 개발자'), index)).toBeNull()
})

test('회사가 다르면 직무가 같아도 중복이 아니다', () => {
  const index = [c('a', 'wanted', '루닛', 'Senior Full Stack Engineer')]
  expect(findDuplicate(c('b', 'remember', '토스', 'Senior Full Stack Engineer'), index)).toBeNull()
})

// 인덱스는 first_seen_at 오름차순으로 들어온다 — 앞에 있는 것이 원본이다.
// 실행 순서나 소스 순서로 결과가 흔들리면 안 된다.
test('후보가 여럿이면 먼저 수집된 쪽을 원본으로 삼는다', () => {
  const index = [
    c('old', 'wanted', '루닛', 'Senior Full Stack Engineer'),
    c('new', 'wanted', '루닛', 'Senior Full Stack Engineer · Platform'),
  ]
  expect(findDuplicate(c('x', 'remember', '루닛', 'Senior Full Stack Engineer'), index)?.id)
    .toBe('old')
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/graph/test/dedup.test.ts`
Expected: FAIL — not exported

- [ ] **Step 3: `dedup.ts`를 만든다**

```ts
import type { DedupCandidate } from '@job-finder/db'

/**
 * 직무명이 이보다 짧으면 판정하지 않는다. 포함 관계로 보기 때문에 '개발자' 같은
 * 짧은 제목은 같은 회사의 아무 공고나 빨아들인다.
 */
const MIN_POSITION_LENGTH = 8

/** 두 사이트가 같은 회사를 다르게 적는 방식 — 법인격 표기가 대부분이다. */
const LEGAL_FORMS = /\(주\)|\(유\)|㈜|㈜|주식회사|유한회사|\binc\b|\bcorp\b|\bltd\b|\bco\b/gi

/** 대괄호 블록은 Remember가 붙이는 [회사명] 접두다. 내용이 회사명이라 비교에 방해만 된다. */
const BRACKET_BLOCK = /\[[^\]]*\]/g

export function normalizeCompany(name: string): string {
  return name.replace(LEGAL_FORMS, '').replace(/[\s.]/g, '').toLowerCase()
}

export function normalizePosition(title: string): string {
  return title.replace(BRACKET_BLOCK, '').replace(/\s/g, '').toLowerCase()
}

/**
 * 같은 공고로 볼 기존 행을 찾는다. 없으면 null.
 *
 * index는 first_seen_at 오름차순이어야 한다 — 후보가 여럿일 때 먼저 수집된 쪽을
 * 원본으로 삼아야 실행 순서나 소스 순서로 결과가 흔들리지 않는다.
 */
export function findDuplicate(
  candidate: DedupCandidate,
  index: DedupCandidate[],
): DedupCandidate | null {
  const company = normalizeCompany(candidate.companyName)
  const position = normalizePosition(candidate.position)
  if (position.length < MIN_POSITION_LENGTH) return null

  for (const existing of index) {
    if (existing.id === candidate.id) continue
    if (normalizeCompany(existing.companyName) !== company) continue
    const other = normalizePosition(existing.position)
    if (other.length < MIN_POSITION_LENGTH) continue
    if (position.includes(other) || other.includes(position)) return existing
  }
  return null
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run packages/graph/test/dedup.test.ts`
Expected: PASS

- [ ] **Step 5: discover 노드에 붙인다**

`packages/graph/src/nodes/discover.ts` — `DiscoverResult`에 필드를 추가하고:

```ts
export interface DiscoverResult {
  searchId: string
  found: number
  created: number
  /** 이번에 중복으로 표시한 공고 수. */
  duplicates: number
}
```

`insertJobs` 뒤에 붙인다:

```ts
        // 인덱스를 insert **전에** 읽는다. 뒤에 읽으면 같은 배치의 새 행끼리
        // 서로를 중복으로 지목한다.
        const dedupIndex = await deps.store.listDedupIndex()
        const created = await deps.store.insertJobs(rows)

        const pairs = created.flatMap((job) => {
          const original = findDuplicate(job, dedupIndex)
          return original ? [{ jobId: job.id, duplicateOf: original.id }] : []
        })
        if (pairs.length > 0) await deps.store.markDuplicates(pairs)
```

반환에 `duplicates: pairs.length`를 넣는다.

`packages/graph/src/pipelines/collect.ts`의 `CollectReport`에도 합계를 더한다:

```ts
  /** 이번 실행에서 중복으로 표시한 공고 수. */
  duplicates: number
```
```ts
      duplicates: discovered.ok.reduce((sum, r) => sum + r.duplicates, 0),
```

- [ ] **Step 6: discover 테스트를 보강한다**

`packages/graph/test/discover.test.ts`에 추가:

```ts
test('같은 배치 안의 새 행끼리는 중복으로 지목하지 않는다', async () => {
  const store = new MemoryStore()
  store.searches.push({
    id: 's1', source: 'wanted', url: 'u', enabled: true,
    params: { source: 'wanted', jobGroupId: '1', tagTypeIds: [], locations: [],
      yearsFrom: 0, yearsTo: 10, country: 'kr', sort: 'job.latest_order' },
  })
  const refs: ExternalRef[] = ['a', 'b'].map((id) => ({
    externalId: id,
    job: { externalId: id, position: 'Senior Frontend Engineer', companyName: '루닛',
      companyId: null, addressDistrict: null, addressFull: null, url: 'u', dueTime: null },
  }))
  const node = createDiscoverNode({
    store, sources: { wanted: fakeSource(refs), remember: fakeSource([]) },
  })
  const result = await node.run(store.searches[0]!)

  expect(result.ok).toBe(true)
  expect(result.value!.duplicates).toBe(0)
})
```

- [ ] **Step 7: 테스트와 타입체크**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add packages/graph
git commit -m "feat(graph): 수집 시 교차 중복을 표시한다

인덱스를 insert 전에 읽는다 — 뒤에 읽으면 같은 배치의 새 행끼리 서로를
중복으로 지목한다.

직무명은 완전 일치가 아니라 정규화 후 포함 관계로 본다. Remember는
제목에 [회사명] 접두와 · 팀명 접미를 붙여서, 완전 일치로는 실측 케이스
(루닛 Senior Full Stack Engineer)를 놓친다. 짧은 제목이 아무거나 빨아들이지
않도록 8자 가드를 둔다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: 대시보드 — 중복 토글과 출처 배지

**Files:**
- Modify: `apps/web/app/jobs/_components/job-list.tsx:188-200`
- Modify: `apps/web/app/jobs/_components/job-card.tsx`
- Modify: `apps/web/app/jobs/[id]/page.tsx`
- Modify: `packages/db/src/types.ts` (`DashboardRow`에 `source`, `duplicateOf`)
- Modify: `packages/db/src/memory-store.ts`, `supabase-store.ts` (`DashboardRow` 매핑)

**Interfaces:**
- Consumes: `DashboardFilters.duplicatesOnly` (Task 7)
- Produces: `DashboardRow.source: Source`, `DashboardRow.duplicateOf: string | null`

- [ ] **Step 1: `DashboardRow`에 두 칸을 더한다**

`packages/db/src/types.ts`의 `DashboardRow`에 (이 타입의 id 칸은 `id`가 아니라 `jobId`다):

```ts
  source: Source
  /** 중복이면 원본 job id. 카드에서 원본으로 가는 링크를 만든다. */
  duplicateOf: string | null
```

두 Store의 `listDashboardJobs` 매핑과 `select(...)` 컬럼 목록에 `source`, `duplicate_of`를 추가한다. `supabase-store.ts:43`의 embed 컬럼 문자열이 그 자리다.

- [ ] **Step 2: 토글을 단다**

`apps/web/app/jobs/_components/job-list.tsx`의 `hiddenOnly` 버튼 바로 옆에, 같은 모양으로 추가한다 (기존 버튼의 className·aria 패턴을 그대로 복사해 쓴다):

```tsx
        <button
          type="button"
          aria-pressed={!!filters.duplicatesOnly}
          onClick={() => setFilters((f) => ({ ...f, duplicatesOnly: !f.duplicatesOnly }))}
          className={/* hiddenOnly 버튼과 같은 식 */}
        >
          중복
        </button>
```

- [ ] **Step 3: 출처 배지를 단다**

`apps/web/app/jobs/_components/job-card.tsx`에 회사명 옆으로:

```tsx
{/* 출처가 둘이 되면서 같은 회사·비슷한 제목이 나란히 보일 수 있다 —
    어디서 온 공고인지가 카드에서 바로 보여야 한다. */}
<span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
  {row.source === 'remember' ? '리멤버' : '원티드'}
</span>
```

중복 행이면 원본 링크를 덧붙인다:

```tsx
{row.duplicateOf && (
  <a href={`/jobs/${row.duplicateOf}`} className="text-xs text-neutral-500 underline">
    원본 보기
  </a>
)}
```

`apps/web/app/jobs/[id]/page.tsx`에도 같은 배지를 단다.

- [ ] **Step 4: 실제 앱으로 확인한다**

```bash
ln -sf ../../.env.local apps/web/.env.local   # 이미 있으면 생략
pnpm dev
```

`/jobs`에서 확인할 것:
- 기본 화면에 중복 공고가 안 보인다
- "중복" 토글을 켜면 중복만 보이고, 각 카드에 "원본 보기"가 있다
- 출처 배지가 카드마다 보인다

- [ ] **Step 5: 테스트와 타입체크**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/web packages/db
git commit -m "feat(dashboard): 출처 배지와 중복 토글을 붙인다

출처가 둘이 되면서 같은 회사·비슷한 제목이 나란히 보일 수 있다.
중복은 기본으로 숨기되 토글로 꺼내 볼 수 있어야 한다 — 판정이
휴리스틱이라 사람이 확인할 창이 필요하다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 문서 갱신과 실검증

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/operations.md`

- [ ] **Step 1: `CLAUDE.md`를 갱신한다**

"회사 별점은 Blind HTML을 긁어 온다" 섹션 **뒤에** 새 절을 넣는다:

```markdown
### 소스는 둘이고, 노드가 행마다 고른다

`packages/sources/src/{wanted,remember}/`가 각각 `JobSource`를 구현하고,
`createSourceRegistry()`가 `Record<Source, JobSource>`로 묶는다. discover는
`search.source`로, fetchDetail·recheck는 `job.source`로 구현을 고른다.
**소스별로 큐를 나누지 마라** — `listJobsNeedingDetail(50)`은 Vercel 함수
시간 예산의 단위라, 소스로 쪼개면 백로그가 쌓인 쪽이 굶는다.

**Remember는 HTML이 아니라 JSON API다** (`career-api.rememberapp.co.kr`,
비인증). Blind의 마크업 경고를 여기 복사하지 마라 — 자기네 앱이 쓰는 계약이라
훨씬 안정적이다.

**Remember는 필터 이름이 틀리면 400이 아니라 그 필터를 무시하고 200을 준다.**
페이지 URL은 camelCase인데 API 본문은 snake_case다. 실측에서 122건이어야 할
결과가 12,894건이 됐다. `listRefs`가 응답의
`meta.logger_info.query_meta_data.search` 에코를 검사해 422로 끊는다 —
이 검사를 지우면 조건에 맞지 않는 전량이 조용히 수집된다.

마감 표기도 다르다 — Wanted `'close'`, Remember `'closed'`. 그래서
`parseOpenState`가 자유 함수가 아니라 `JobSource` 메서드다.
```

"함정" 목록에 한 줄 더한다:

```markdown
- **교차 중복은 `hidden`이 아니라 `jobs.duplicate_of`로 표시한다.** `hidden`은 이미
  쓰는 주체가 셋이라(사람·저점수 자동·마감 자동) 네 번째가 끼면 "왜 안 보이는가"를
  되짚을 수 없다. 판정은 휴리스틱이므로 행을 지우지 않는다 — `/jobs`의 중복 토글로
  확인하고 되돌릴 수 있어야 한다.
```

- [ ] **Step 2: `docs/operations.md`를 갱신한다**

마이그레이션 0010·0011의 적용 순서와 **코드 배포보다 먼저 적용해야 한다**는 점, Remember 검색 등록 방법(`pnpm backfill --url '<Remember 검색 URL>'`)을 적는다. 파일의 기존 서술 방식을 따른다.

- [ ] **Step 3: 마이그레이션을 적용한다 (사람이 한다)**

Supabase 대시보드 SQL Editor에서 순서대로 실행한다:
1. `packages/db/migrations/0010_searches_source.sql`
2. `packages/db/migrations/0011_jobs_duplicate_of.sql`

적용 후 확인:

```sql
select column_name from information_schema.columns
 where table_name = 'searches' and column_name = 'source';
select column_name from information_schema.columns
 where table_name = 'jobs' and column_name = 'duplicate_of';
-- security_invoker가 살아 있는지 (비어 있으면 RLS 구멍이다)
select reloptions from pg_class where relname = 'jobs_needing_score';
```

- [ ] **Step 4: Remember 검색을 등록하고 실수집한다**

```bash
pnpm backfill --url 'https://career.rememberapp.co.kr/job/postings?search=%7B%22jobCategoryNames%22%3A%5B%7B%22level1%22%3A%22SW%EA%B0%9C%EB%B0%9C%22%2C%22level2%22%3A%22%ED%94%84%EB%A1%A0%ED%8A%B8%EC%97%94%EB%93%9C%22%7D%5D%2C%22addresses%22%3A%5B%5B%22%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C%22%5D%2C%5B%22%EA%B2%BD%EA%B8%B0%EB%8F%84%22%5D%5D%2C%22organizationType%22%3A%22without_headhunter%22%2C%22minExperience%22%3A7%7D'
```

출력된 insert 문을 SQL Editor에서 실행한 뒤:

```bash
pnpm backfill
```

**확인할 것:**
- `created`가 **122건 근처**다. 수천 건이면 필터가 무시된 것이고, 에코 검사가 동작하지 않은 것이다 — 그 경우 수집분을 지우고 원인을 먼저 잡아라.
- `duplicates`로 표시된 건수를 SQL로 뽑아 짝을 눈으로 확인한다:

```sql
select d.company_name, d.position as dup_position, o.position as original_position,
       d.source as dup_source, o.source as original_source
  from jobs d join jobs o on o.id = d.duplicate_of
 where d.duplicate_of is not null;
```

오탐이 보이면 `MIN_POSITION_LENGTH`를 올리고, 잘못 찍힌 행은 `update jobs set duplicate_of = null where id = '...'`로 되돌린다.

- [ ] **Step 5: 커밋**

```bash
git add CLAUDE.md docs/operations.md
git commit -m "docs: Remember 소스와 교차 중복 처리를 문서에 반영한다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## 검증 체크리스트

전부 끝난 뒤:

- [ ] `pnpm test` 통과
- [ ] `pnpm typecheck` 통과
- [ ] 마이그레이션 0010·0011 적용 완료, `jobs_needing_score`에 `security_invoker=true` 남아 있음
- [ ] Remember 수집 결과가 122건 근처 (수천 건이 아님)
- [ ] 중복 짝을 눈으로 확인, 오탐 없음
- [ ] `/jobs` 기본 화면에 중복이 안 보이고, 토글로 보임
- [ ] 출처 배지가 목록·상세에 보임
- [ ] `/api/run?stage=collect`가 200을 돌려줌

# Remember 소스 추가 — 설계 문서

- 작성일: 2026-09-17
- 상태: 승인됨 (구현 계획 대기)
- 선행 문서: [2026-08-15-job-finder-design.md](2026-08-15-job-finder-design.md)

## 1. 목적

채용 공고 수집원을 Wanted 한 곳에서 Remember(career.rememberapp.co.kr)를 포함한 둘로 늘린다.

원 설계 문서가 범위에서 빼면서 "`JobSource` 인터페이스로 확장 지점만 열어둔다"고 적었던 그
지점을 실제로 여는 작업이다. 따라서 이 문서의 절반은 Remember 구현이고, 나머지 절반은
**단일 소스를 전제로 굳어 있던 배선을 푸는 일**이다.

대상 검색은 다음 URL이다 (SW개발/프론트엔드 · 서울+경기 · 헤드헌터 제외 · 경력 7년 이상):

```
https://career.rememberapp.co.kr/job/postings?search={"jobCategoryNames":[{"level1":"SW개발","level2":"프론트엔드"}],"addresses":[["서울특별시"],["경기도"]],"organizationType":"without_headhunter","minExperience":7}
```

실측 기준 122건 / 5페이지(per=30)다.

## 2. 범위

### 포함

- `packages/sources/src/remember/` — Remember 소스 구현 (목록·상세·마감상태)
- `JobSource` 레지스트리 — discover / fetchDetail / recheck 세 노드가 행마다 소스를 고른다
- `searches.source` 컬럼과 소스별 판별 유니온 `SearchParams`
- 교차 중복 표시 — `jobs.duplicate_of` 컬럼, 기본 비노출, `/jobs`에 토글 필터
- 출처 배지 (목록 카드 · 상세)

### 제외

- **연봉 정보 저장** — Remember는 `min_salary`/`max_salary`/`total_compensation`을 주지만
  스키마에 칸이 없다. `raw`에 통째로 남으므로 나중에 컬럼을 추가하면 재수집 없이 꺼낼 수 있다.
- **루브릭 변경** — 채점 입력 형태가 달라지지 않는다 (§5 참조). 루브릭을 건드리면 기존
  전량을 재채점해야 한다.
- **cron 예산 상수 조정** — 코퍼스가 두 배가 되면서 재확인 주기가 눌린다(§9). 첫 수집 후
  실측해서 정한다.
- **세 번째 소스** — 이번에 여는 확장 지점이 그걸 받아내는지가 이 설계의 검증 기준이지만,
  실제로 추가하지는 않는다.

## 3. Remember 수집 경로

### 3.1 API

Blind와 달리 **HTML을 파싱하지 않는다.** Remember는 자기 웹앱이 쓰는 JSON API가 그대로
열려 있다.

| 용도 | 요청 |
|---|---|
| 목록 | `POST https://career-api.rememberapp.co.kr/job_postings/search` |
| 상세 | `GET  https://career-api.rememberapp.co.kr/job_postings/{id}` |
| 공고 URL | `https://career.rememberapp.co.kr/job/postings/{id}` |

인증은 필요 없다. 쿠키·토큰 없이 200이 온다.

찾아낸 경로를 남겨둔다 — 마크업이 바뀌어도 같은 방법으로 다시 찾을 수 있게:
검색 페이지 HTML에는 공고가 한 건도 없다(`/job/postings/{id}` 링크 0개). 목록이 클라이언트에서
그려지기 때문이다. `__NEXT_DATA__`의 react-query dehydratedState에도 배너와 시드밖에 없다.
엔드포인트 경로는 페이지 번들 `_next/static/chunks/pages/job/postings-*.js`에,
`baseURL`은 `_next/static/chunks/pages/_app-*.js`에 각각 문자열로 들어 있다.

Wanted와의 유일한 구조적 차이는 **목록이 GET 쿼리스트링이 아니라 POST 본문**이라는 점이다.
그래서 `client.ts`에 `getJson` 옆에 `postJson`이 필요하고, `parse-url.ts`가 만드는 것도
URL이 아니라 body 객체다.

### 3.2 필터가 조용히 무시된다 — 이 소스의 유일한 함정

페이지 URL의 `search` JSON은 camelCase(`jobCategoryNames`, `minExperience`)인데
**API 본문은 snake_case를 받는다.** camelCase로 보내면 400이 아니라 **그 필터를 무시하고 200을
돌려준다.** 실측에서 122건이어야 할 결과가 12,894건으로 나왔다.

그래서 케이스 자동 변환 함수를 쓰지 않는다. 변환표를 코드에 한 번 명시적으로 적어, 눈으로
대조할 수 있게 한다.

| 페이지 URL (camelCase) | API 본문 (snake_case) |
|---|---|
| `jobCategoryNames` | `job_category_names` |
| `addresses` | `addresses` |
| `organizationType` | `organization_type` |
| `minExperience` | `min_experience` |

**드리프트 감지 장치**는 응답 메타다. 서버가 실제로 해석한 필터가 그대로 돌아온다:

```jsonc
meta.logger_info.query_meta_data.search
// 정상: { "job_category_ids": [311], "organization_type": "without_headhunter",
//         "min_experience": 7, "addresses": [["서울특별시"],["경기도"]], ... }
// 무시: { "job_category_names": null, "organization_type": null, "min_experience": null, ... }
```

`listRefs`는 첫 페이지에서 이 에코를 검사해, 우리가 보낸 필터 중 하나라도 `null`로 돌아오면
`fail`로 끊는다. 이 검사가 없으면 필터가 무시된 12,894건이 조용히 수집된다.

Blind의 픽스처 테스트가 "파싱 실패와 미등록을 구분하지 못한다"는 한계를 안고 있는 것과 달리,
여기서는 구분할 수 있다. 구분할 수 있으면 반드시 구분해서 실패시킨다.

### 3.3 페이징

body에 `page`(1-base) / `per`를 싣고, 응답 `meta.total_pages`까지 돈다. 실측:

```
per=30 → page 1: data[30], total_pages 5, total_count 122
         page 5: data[2]
         page 6: data[0]        ← 에러가 아니라 빈 배열
```

`sort: "starts_at_desc"`를 받는다. Wanted와 같이 `MAX_PAGES` 상한을 둔다.

## 4. 모듈 구조

Wanted와 같은 4파일 구조로 `packages/sources/src/remember/`에 놓는다.

```
remember/
  parse-url.ts   페이지 URL ?search=<json> → RememberSearchParams
                 RememberSearchParams → API 본문 (snake_case 명시 매핑)
  client.ts      postJson / getJson, 타임아웃, SourceHttpError
  normalize.ts   목록 → ExternalRef[], 상세 → JobDetailFields, 상세 → JobOpenState
  index.ts       createRememberSource(fetchImpl): JobSource
```

### 4.1 공용으로 올리는 것

- **`normalizeDueTime`** — `wanted/normalize.ts`에서 소스 공용 모듈로 올린다.
  이 함수가 막는 것은 Wanted의 특성이 아니라 **Postgres `date` 컬럼이 `2026-02-30` 같은 값에
  22007로 배치 insert 전체를 죽이는 것**이다. 소스마다 복제하면 안 되는 종류의 규칙이다.

- **`SourceHttpError`** — 지금 `WantedHttpError`를 discover / fetchDetail / recheck 세 노드가
  `instanceof`로 검사한다. 베이스 클래스를 만들고 두 클라이언트가 그것을 던지게 한 뒤, 노드는
  베이스로 검사한다. `retryable` 판정 규칙(5xx·429·타임아웃)은 그대로다.
  실패 코드는 `WANTED_HTTP` → `SOURCE_HTTP`로 바뀐다. 기존 `node_runs` 행에는 옛 코드가 남지만
  조회용 기록이라 문제되지 않는다.

## 5. 필드 매핑

### 5.1 목록 → `NewJob`

| 컬럼 | Remember |
|---|---|
| `source` | `'remember'` |
| `externalId` | `String(id)` |
| `position` | `title` |
| `companyName` | `organization.name` |
| `companyId` | `organization.company_id` |
| `addressDistrict` | `normalized_address.level2` |
| `addressFull` | `addresses[0].address_level1 + ' ' + addresses[0].address_level2` |
| `url` | `https://career.rememberapp.co.kr/job/postings/{id}` |
| `dueTime` | `ends_at` → `normalizeDueTime` (대부분 null = 상시) |

### 5.2 상세 → `JobDetailFields`

| 필드 | Remember | 비고 |
|---|---|---|
| `annualFrom` | `min_experience ?? 0` | 0 = 신입 포함. Wanted와 같은 규약 |
| `annualTo` | `max_experience ?? 100` | `NO_UPPER_BOUND` 센티널 재사용 |
| `intro` | `introduction` | |
| `requirements` | `qualifications` | |
| `mainTasks` | `job_description` | |
| `preferredPoints` | `preferred_qualifications` | |
| `benefits` | `additional_information` | 근무조건·복리후생이 여기 들어 있다 |
| `skillTags` | `[]` | 아래 참조 |
| `raw` | 상세 응답 전체 | |

**`annualTo`에 100 센티널을 재사용하는 이유**: Remember는 상한 없음을 `null`로 표현하지만,
`null`을 그대로 저장하면 `formatExperience(7, null)`이 `null`을 돌려줘 화면에 경력이 아예
표시되지 않는다. 100으로 맞추면 `"경력 7년 이상"` 분기와 `experience.test.ts`가 그대로
Remember를 덮는다. 새 규약을 만들면 표기 함수와 그 테스트가 소스별로 갈라진다.

**`skillTags`를 빈 배열로 두는 이유**: Remember에는 기술 태그가 없다. 가장 가까운 것은
`job_categories`의 level2(`["프론트엔드","풀스택","블록체인"]`)인데 이건 **직무 분류지 기술
스택이 아니다.** `skillTags`는 `packages/scoring/src/index.ts`를 통해 채점 프롬프트에 그대로
들어가므로, 분류명을 스택으로 넘기면 루틴이 잘못 읽는다. 기술 스택 정보는 `qualifications`
본문에 이미 다 있다.

**버리는 필드**: `recruiting_process`(전형 절차), `company_description`(대개 `[글로벌 기업]`
같은 한 줄 태그), `education_requirement`, 연봉 3종. 모두 `raw`에 남는다.

### 5.3 마감 상태 — `parseOpenState`

Remember 상세의 `status`로 판단한다. 실측:

```
GET /job_postings/341688 → status: "published"                          (열림)
GET /job_postings/300000 → status: "closed"                             (닫힘)
GET /job_postings/200000 → status: "closed", ends_at: 2024-11-19        (2년 전 공고도 HTTP 200)
```

**Wanted는 `'close'`, Remember는 `'closed'`다.** 한 글자 차이지만 이것이 §6의 인터페이스
변경을 강제한다.

`recheck.ts`와 같은 규약을 따른다 — `'closed'`일 때만 닫힌 것으로 보고, 모르는 값이 오면 열린
것으로 둔다. 표기가 바뀌었을 때 멀쩡한 공고를 무더기로 숨기지 않기 위해서다.

## 6. 인터페이스 변경

### 6.1 `JobSource`

```ts
export interface JobSource {
  readonly id: Source                            // 'wanted' 리터럴 → Source
  parseSearchUrl(url: string): SearchParams
  listRefs(params: SearchParams): AsyncIterable<ExternalRef>
  fetchDetail(externalId: string): Promise<RawDetail>
  normalize(raw: RawDetail): JobDetailFields
  parseOpenState(raw: RawDetail): JobOpenState   // ← 추가
}
```

`parseOpenState`를 인터페이스로 올리는 이유는 §5.3이다. 지금 `recheck.ts`는
`parseJobOpenState`를 `@job-finder/sources`에서 **자유 함수로 직접 import**해 어떤 소스의
payload든 Wanted 스키마로 파싱한다. 소스가 하나일 때는 맞는 선택이었고, 지금 그 전제가 깨진다.
Remember 행이 재확인 큐에 들어오는 순간 zod가 던진다.

### 6.2 타입

```ts
export type Source = 'wanted' | 'remember'

export type SearchParams =
  | ({ source: 'wanted' }   & WantedSearchParams)
  | ({ source: 'remember' } & RememberSearchParams)

export interface RememberSearchParams {
  jobCategoryNames: { level1: string; level2: string }[]
  addresses: string[][]
  organizationType: string | null
  minExperience: number | null
}

export interface Search {
  id: string
  source: Source        // ← 추가
  url: string
  params: SearchParams
  enabled: boolean
}
```

판별 유니온으로 두면 컴파일 타임에 잘못된 조합(Wanted 소스에 Remember 파라미터)이 막힌다.

### 6.3 레지스트리 배선

```ts
export type SourceRegistry = Record<Source, JobSource>

runCollect({ store, sources, findRating }, trigger)
//   discover    : sources[search.source]
//   fetchDetail : sources[job.source]
//   recheck     : sources[job.source]
```

`Search`에 `source`가, `Job`에도 이미 `source`가 있으므로(`Job extends NewJob`) 각 노드는
처리 중인 행을 보고 자기 소스를 고른다. `runNode`·`CollectReport`·파이프라인 구조는 손대지
않는다.

**소스별로 `runNode`를 나눠 돌리지 않는 이유**는 상세 대기 큐 때문이다.
`listJobsNeedingDetail(50)`은 "오래된 순 50건"이고 이것이 Vercel 함수 시간 예산의 단위다.
소스별로 나누면 50을 소스 수로 쪼개야 하는데, Wanted에 백로그 200건이 쌓인 날 Remember는
25칸을 놀리고 Wanted는 25칸만 소화한다. 큐를 하나로 유지하면 오래된 것부터 자연히 빠진다 —
채점 큐·별점 큐와 같은 방식이다.

호출부 두 곳(`apps/web/app/api/run/route.ts`, `apps/web/app/api/cron/collect/route.ts`)과
백필 CLI가 레지스트리를 넘기도록 바뀐다.

## 7. 교차 중복

같은 공고가 두 소스에 모두 올라오면 `jobs`에 두 행이 생기고, 둘 다 채점되어 하루 top 3 메일
슬롯을 둘 차지할 수 있다.

### 7.1 왜 `hidden`을 재사용하지 않는가

`hidden`은 이미 쓰는 주체가 셋이다 — 사람이 카드에서 제외한 경우, `0008_hide_low_scores.sql`의
50점 이하 자동 제외, `recordJobRecheck`의 마감 자동 제외. 네 번째로 중복까지 끼워 넣으면
"왜 안 보이는가"를 되짚을 수 없고, 되돌리기의 의미도 모호해진다.

### 7.2 왜 수집 시 버리지 않는가

행을 아예 만들지 않으면 오탐이 영구 손실이 된다. 대기업은 같은 회사·같은 제목으로 서로 다른
팀 공고를 동시에 올린다. 휴리스틱이 이걸 중복으로 보면 DB에 흔적조차 남지 않아 놓쳤다는 사실을
알 방법이 없다. Blind 커버리지를 표본 73%에서 실측 56%로 바로잡을 수 있었던 것은 확정하지 못한
회사도 행으로 남겼기 때문이다.

### 7.3 스키마 — migration 0011

```sql
alter table jobs
  add column if not exists duplicate_of uuid references jobs(id) on delete set null;

-- listDedupIndex("중복 아니고 제외 안 된 것 중 오래된 순")를 받는다.
-- jobs_recheck_idx와 같은 모양의 부분 인덱스다.
create index if not exists jobs_dedup_idx
  on jobs (first_seen_at)
  where duplicate_of is null and hidden = false;
```

`null`이 "중복 아님"이다. 어느 공고의 중복인지까지 남으므로 대조가 된다.
`on delete set null`은 원본이 지워져도 중복 행이 살아남게 한다.

`jobs_needing_score` 뷰를 재생성해 `and j.duplicate_of is null`을 넣는다. 중복은 채점하지 않는다.

> **주의**: 뷰 재생성 시 `with (security_invoker = true)`를 빠뜨리면 anon이 뚫린다.
> 0001의 주석이 경고한 그 구멍이다.

### 7.4 판정

discover에서, **저장한 뒤**에 한다. insert 전에 기존 행 인덱스를 한 번 읽고, 새로 만들어진
행만 그 인덱스와 대조한다 — 같은 배치 안에서 서로를 중복으로 지목하는 일이 없도록.

```
회사명: 법인격 표기((주), 주식회사, ㈜, (유), Inc., Corp.)·공백 제거 후 완전 일치
직무명: 소문자화 · 공백 제거 · 대괄호 블록([...]) 제거 후
        한쪽이 다른 쪽을 포함(includes) && 짧은 쪽이 정규화 후 8자 이상
```

길이 8은 **정규화를 마친 문자열의 문자 수**다(`'개발자'`는 3자라 탈락, `'프론트엔드개발자'`는
8자라 통과). 후보가 여럿이면 **가장 오래 전에 수집된 행**(`first_seen_at` 오름차순, 동률이면
`id`)을 원본으로 삼는다 — 실행 순서나 소스 순서에 결과가 흔들리지 않게 하기 위해서다.

실측 근거가 되는 케이스:

| 출처 | 회사명 | 직무명 | 결과 |
|---|---|---|---|
| Remember | `(주)루닛` | `[루닛]Senior Full Stack Engineer · AI Platform` | 중복 |
| Wanted | `루닛` | `Senior Full Stack Engineer` | (원본) |

완전 일치를 요구하면 이 케이스를 놓친다. Remember는 제목에 `[회사명]` 접두와 `· 팀명` 접미를
붙이는 경우가 많다. 길이 가드 8은 `'개발자'`(6자) 같은 짧은 제목이 아무거나 빨아들이는 것을
막는다.

**저장 후 판정하는 이유**는 "질의로 대상을 고른다" 원칙을 지키기 위해서다. `duplicate_of`는
언제든 다시 계산해 덮어쓸 수 있는 파생값이고, 원본 행은 그대로 남는다.

### 7.5 Store

```ts
/**
 * 중복 판정용 최소 컬럼. duplicate_of가 null이고 hidden이 아닌 행만,
 * first_seen_at 오름차순으로 준다.
 */
listDedupIndex(): Promise<Array<Pick<Job, 'id' | 'source' | 'companyName' | 'position'>>>
/** 새로 만든 행을 기존 행의 중복으로 표시한다. */
markDuplicates(pairs: Array<{ jobId: string; duplicateOf: string }>): Promise<void>
```

**`hidden`을 후보에서 빼는 것이 중요하다.** `recheck.ts`는 "같은 공고가 다시 올라오면 소스가
새 `external_id`를 주므로(Wanted 실측 7쌍 전부) 새 행으로 들어와 정상 수집·채점된다"를
보장한다. 마감되어 숨겨진 행을 후보로 두면, 재등록된 공고가 그 옛 행의 중복으로 찍혀 영원히
채점되지 않는다 — 재확인 설계가 세운 보장을 중복 판정이 무너뜨리는 셈이다. 사람이 손으로
제외한 공고가 후보에서 빠지는 것도 같은 이유로 바람직하다(다시 올라온 것은 새로 판단할 기회를
얻는다).

전량을 받아 JS에서 맞춘다. `listCompaniesNeedingRating`이 이미 쓰는 패턴이고(수백 행 규모라
페이로드가 작다), 정규화 규칙이 SQL로 새어 나가지 않는다는 장점이 있다.

`listNotifyCandidates`·`listNotifyPending`·`listDashboardJobs`에 `duplicate_of is null` 조건이
들어간다.

## 8. 화면

- `DashboardFilters`에 `duplicatesOnly?: boolean` 추가. `hiddenOnly`와 같은 **배타 버킷**
  방식이라 한 페이지에 두 값이 섞이지 않고, 기존 커서 로직을 그대로 쓴다.
- 기본값은 중복 제외. `/jobs`에 토글을 단다.
- 목록 카드와 상세에 출처 배지(`wanted` / `remember`)를 붙인다.
- 중복 카드에는 원본으로 가는 링크를 둔다.

## 9. 용량

Remember 122건이 들어오면 코퍼스가 대략 두 배가 된다. 현재 상한:

| 항목 | 상한 | 주기 | 두 배 후 |
|---|---|---|---|
| 상세 조회 | 50 / 회 | 매 실행 | 백로그가 하루이틀 더 걸린다 |
| 마감 재확인 | 40 / 회 | 7일 목표 | **한 바퀴 나흘 → 여드레**, 목표를 넘긴다 |
| 별점 조회 | 40 / 회 | 30일 | 여유 있다 |

재확인 주기가 코퍼스에 눌리는 문제는 이번 범위에서 상수를 건드려 해결하지 않는다. 첫 수집 후
실측해서 정한다. 상한을 '건수'가 아니라 '주기를 지키는 데 필요한 건수'로 계산하게 만들 수도
있지만, 실측 없이 만들 만한 장치가 아니다.

## 10. 테스트

| 대상 | 방식 |
|---|---|
| `parse-url` | 페이지 URL → params → API 본문. snake_case 변환표를 못 박는다 |
| `normalize` (목록/상세) | 실제 응답 픽스처 (Wanted·Blind와 동일한 방식) |
| **필터 에코** | `meta…query_meta_data.search`에 `null`이 섞이면 `fail`. camelCase 회귀를 잡는 유일한 장치 |
| `parseOpenState` | `'published'` / `'closed'` / 모르는 값(→ 열림) |
| 페이징 | `total_pages`까지 순회, 빈 페이지에서 정지, `MAX_PAGES` 상한 |
| 중복 판정 | 루닛 케이스 통과, `'개발자'`는 길이 가드로 불일치, 법인격 표기 제거 |
| 레지스트리 | 섞인 큐(wanted + remember)가 각자 맞는 소스로 라우팅되는지 |
| Store | `store-contract.ts`에 `duplicate_of` 케이스 추가 → memory/supabase 두 구현 동시 검증 |

픽스처는 실제 응답을 저장한다. Remember API 계약이 바뀌면 이 테스트가 먼저 깨져야 한다.

## 11. 마이그레이션

수동 적용이다(러너 없음). Supabase 대시보드 SQL Editor에서 사람이 실행한다.

- `0010_searches_source.sql` — `searches.source text not null default 'wanted'`
- `0012_searches_params_source.sql` — 기존 검색 행의 params에 source 판별자를 채워 넣는다
- `0011_jobs_duplicate_of.sql` — `duplicate_of` 컬럼 + 인덱스, `jobs_needing_score` 뷰 재생성

적용 순서는 `0010 → 0012 → 0011 → 배포`다. 번호와 적용 순서가 다른 유일한 지점이다 —
0012는 0011보다 나중에 만들어졌지만 0010이 남긴 간극(아래)을 메우는 것이라 0010 바로
뒤, 배포보다는 반드시 먼저 적용해야 한다.

`searches.source`가 먼저 있어야 소스 레지스트리 배선이 성립한다.

`searches.source` 컬럼은 default `'wanted'`라 기존 행에도 채워지지만, discover의
SOURCE_MISMATCH 가드는 컬럼이 아니라 params 안의 source 판별자를 본다. 이 브랜치
이전에 저장된 Wanted 검색 행의 params에는 그 키가 없으므로(pre-branch
parseWantedSearchUrl은 source를 넣지 않았다), 0010만 적용하고 배포하면 기존 Wanted
검색 전부가 매 실행 SOURCE_MISMATCH로 영구히 실패한다 — "적용 전후 동작이 같다"는
말은 틀렸다. `0012_searches_params_source.sql`이 컬럼값을 params 안으로 복사해
이 간극을 메운다.

`duplicate_of`는 적용 전에는 컬럼이 없어 코드가 죽는다 — **코드 배포 전에 적용해야 한다.**

Remember 검색 행은 마이그레이션이 아니라 대시보드에서 URL을 등록해 만든다.

## 12. 검증 순서

1. 전체 테스트 통과 (`pnpm test`, `pnpm typecheck`)
2. 마이그레이션 두 개 적용
3. 백필 CLI로 Remember 검색 1건 등록 후 전량 수집 — 122건 근처가 나오는지, 12,894건이
   아닌지 확인 (필터 무시 회귀의 실물 확인)
4. 중복으로 표시된 건수와 그 짝을 눈으로 확인. 오탐이 있으면 길이 가드를 올린다
5. `/jobs`에서 출처 배지·중복 토글 확인

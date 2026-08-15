# job-finder 대시보드 설계 (Plan 2)

Plan 1(수집·채점·알림 파이프라인)은 배포되어 동작 중이다. 이 문서는 그 위에
얹는 웹 대시보드의 설계다.

## 1. 왜 만드는가

채점이 **수동/로컬**로 확정되면서 운영 상태가 보이지 않는다. 지금 소유자가
알 수 있는 것은 매일 오는 다이제스트 메일 한 통뿐이고, 그 메일은 상위 몇 건만
담는다. 다음 질문들에 답할 수단이 없다.

- 채점이 며칠째 안 돌고 있나?
- 168건 중 몇 건이 채점됐고, 어떤 루브릭 버전으로 매겨졌나?
- 오늘 밤 나갈 후보가 있나?
- 70점 아래로 잘린 공고들은 어떤 것들이었나?
- 이 공고가 왜 84점인가?

특히 첫 번째가 중요하다. 채점이 멈추면 다이제스트가 조용해지는데, 그 침묵은
"오늘 좋은 공고가 없었다"와 **구분되지 않는다**. cron 라우트가 200을 반환하기
때문이다. 대시보드는 그 침묵에 이름을 붙인다.

## 2. 범위

**포함** — 운영 상태 조회, 채점된 공고 목록·상세, 북마크 토글.

**제외** — 설정 편집(프로필·알림 규칙·검색 URL), 수동 실행 버튼, 숨김 토글,
재채점 트리거. 전부 스펙 §Plan 2에 있지만 지금 필요하지 않다. 설정은 현재
`curl`로 충분히 바꾸고 있고, 수동 실행은 `/api/run`이 이미 있다.

**멀티유저 아님.** Plan 1과 같다. 인증도 없다(§9).

## 3. 화면

### 3.1 목록 `/`

상단 상태 스트립, 하단 공고 카드 목록.

**상태 스트립** — 카드 4개 + 최근 실행 줄.

| 카드 | 값 | 출처 |
| --- | --- | --- |
| 채점 진행 | `168 / 168` | `count(scores)` / `count(jobs)` |
| 마지막 채점 | `2시간 전` | `max(scores.scored_at)` |
| 알림 대기 | `0건` | `notified_at is null and total >= minScore` |
| 루브릭 | `v3: 168` | `scores.rubric_version` 분포 |

**마지막 채점이 7일을 넘으면 그 카드를 경고 상태로 표시한다.** 이 화면을
만드는 가장 큰 이유다. 값이 여러 버전으로 갈리면 루브릭 카드도 경고로 둔다 —
서로 다른 기준으로 매긴 점수가 같은 순위 경쟁을 하고 있다는 뜻이다.

최근 실행 5건은 `pipeline · 시각 · 성공/실패 건수`로 한 줄씩 보여준다.

**공고 카드** — 한 행에 점수, 회사, 포지션, 축 요약, 마감, 발송 여부, 북마크.
스캔이 목적이므로 근거 텍스트는 넣지 않는다. 카드 전체가 상세로 가는 링크다.

**필터** — 최소 점수, 북마크만, 미발송만. 세 개 다 서버로 넘어간다(§5).

**기본값은 필터 없음이다.** 채점된 전부를 점수 내림차순으로 보여준다.
`notify_rule.minScore`를 기본값으로 쓰지 않는다 — §1의 "70점 아래로 잘린 공고는
어떤 것들이었나"에 답하려면 잘린 것이 보여야 한다.

`hidden = true`인 공고는 항상 제외한다.

### 3.2 상세 `/jobs/[id]`

공고 하나를 판단하는 데 필요한 것을 전부 담는다. Wanted 상세 응답을 이미
저장하고 있으므로(`intro`, `requirements`, `main_tasks`, `preferred_points`,
`benefits`, `skill_tags`) 원티드로 나가지 않고도 읽을 수 있다.

- 헤더: 회사 · 포지션 · 총점 · 북마크 · 원티드 원문 링크
- 채점: 축별 점수를 막대로, 근거 전문, `rubric_version`·`scored_at`·`scorer`
- 공고: 회사 소개, 주요 업무, 자격 요건, 우대 사항, 복지, 기술 태그, 마감일

서버 컴포넌트로 렌더한다. 클라이언트 페칭이 없으므로 URL을 열면 바로 완성된
화면이 온다.

## 4. 데이터 흐름

```
app/page.tsx           서버 컴포넌트 — 첫 페이지 + 통계 조회
 ├─ <StatusStrip>      서버 컴포넌트, 순수 렌더
 └─ <JobList>          클라이언트 — 필터 상태, 무한스크롤, 북마크
app/jobs/[id]/page.tsx 서버 컴포넌트 — 상세 전체
app/actions.ts         Server Action — loadMoreJobs, toggleBookmark
```

**서버가 I/O, 클라이언트가 상호작용.** service role 키는 서버에만 있고
브라우저로 내려가지 않는다. 페이지가 공개이므로(§9) 이 경계가 유일한 방어선이다.

**더 불러오기와 북마크는 Server Action으로 한다.** 새 JSON API 라우트를 만들지
않는다 — 공개 페이지에 조회용 엔드포인트를 늘리면 표면만 넓어진다. Server
Action은 그 자체로 서버 경계 안에 있고 별도 인증 설계가 필요 없다.

## 5. 페이징 — 복합 커서

정렬은 `total DESC, job_id DESC`로 고정한다. 페이지 크기 100.

**커서는 `(total, jobId)` 두 값이다.** 실측상 168건이 60개 점수 값에 몰려
있고(151행이 동점 그룹, 최대 9행) `total` 단독 커서로는 페이지 경계에서 행이
누락되거나 중복된다. offset도 쓰지 않는다 — 북마크 토글이나 신규 채점으로
행 순서가 바뀌면 같은 행을 다시 보게 된다.

```ts
listDashboardJobs(params: {
  minScore?: number
  bookmarkedOnly?: boolean
  unnotifiedOnly?: boolean
  cursor?: { total: number; jobId: string }
  limit: number
}): Promise<{ rows: DashboardRow[]; nextCursor: { total: number; jobId: string } | null }>
```

PostgREST에서는 `total.lt.X` 또는 `(total.eq.X and job_id.lt.Y)`의 or 조건으로
표현한다.

`nextCursor`가 `null`이면 끝이다. 클라이언트는 IntersectionObserver로 목록
끝을 감지해 다음 장을 요청한다.

## 6. Store 인터페이스

포트에 4개를 추가한다. `MemoryStore`·`SupabaseStore`·공유 계약 테스트가
함께 움직인다.

| 메서드 | 반환 |
| --- | --- |
| `listDashboardJobs(params)` | `{ rows, nextCursor }` (§5) |
| `getJobDetail(jobId)` | 공고 전문 + 점수 + 근거, 없으면 `null` |
| `getDashboardStats()` | 건수, `lastScoredAt`, 루브릭 분포, 최근 실행 5건 |
| `setJobBookmarked(jobId, value)` | `void` |

**`DashboardRow`에 `reasoning`을 넣지 않는다.** 실측 결과 168행 페이로드
107 KB 중 64 KB(60%)가 `reasoning`인데, 목록에서는 한 번도 표시되지 않는다.
상세에서 `getJobDetail`이 가져온다. `raw`와 JD 본문도 목록 조회에서 제외한다.

## 7. 마이그레이션 0003 — `runs.pipeline`

현재 `runs`에는 `trigger`(`cron`/`manual`)만 있어 **collect인지 notify인지
구분할 수 없다.** `node_runs`로 역추적할 수 있지만, 아무 항목도 처리하지 않은
실행(후보가 없어 skip한 notify, 신규 0건인 collect)은 `node_runs`가 비어 있어
판별이 불가능하다. 실측: 최근 6건 중 2건이 그렇다.

"마지막 collect가 언제 돌았나"는 상태 스트립의 핵심 질문이므로 컬럼을 추가한다.

```sql
alter table runs add column if not exists pipeline text;
```

`not null`을 걸지 않는다 — 기존 행에는 값이 없고, 소급해 채울 근거가 없다.
표시할 때 `null`은 `알 수 없음`으로 둔다.

`startRun(trigger)` → `startRun(pipeline, trigger)`로 시그니처가 바뀐다.
Store 포트, 두 구현, 계약 테스트, `runCollect`·`runNotify`가 함께 바뀐다.

마이그레이션은 사람이 Supabase 대시보드에서 실행한다(레포에 러너가 없다).
**적용 전에는 새 코드가 없는 컬럼에 쓰려다 실패한다.** 배포보다 마이그레이션이
먼저다.

## 8. UI 기반

Tailwind v4 + shadcn/ui. 현재 `apps/web`에는 CSS 파일조차 없다.

가져오는 컴포넌트는 실제로 쓰는 것만: `Table`, `Badge`, `Button`, `Input`,
`Select`. 펼치기가 없어졌으므로 `Collapsible`도 필요 없다.

처음 스택으로 shadcn을 지정했고, 이후 설정 편집 화면이 예정되어 있다. 지금
손으로 CSS를 쓰면 그때 다시 쓰게 된다.

## 9. 인증 — 없음

소유자의 결정이다. `jobsonar.vercel.app`은 공개로 둔다.

**따르는 결과를 명시한다.**

- 채점 `reasoning`에 경력 정보가 그대로 담긴다("13년차", "챕터장 경험",
  "커머스 직접 경험"). 이력서 본문을 렌더하지 않아도 프로필이 상당히 드러난다.
  상세 페이지는 이 텍스트를 전문으로 보여준다.
- **북마크 토글은 누구나 할 수 있다.** URL을 아는 사람이면 된다. 파괴적이지는
  않다 — 공고와 점수는 바뀌지 않고 플래그만 뒤집힌다.

완화책 하나만 넣는다: `layout.tsx` metadata에 `robots: { index: false }`.
검색엔진 색인은 막는다.

`profile.resume_text`는 어떤 화면에도 렌더하지 않는다. 이 범위에서는 필요가 없다.

## 10. 에러 처리

- 조회 실패 시 서버 컴포넌트가 throw → `app/error.tsx`가 **실제 메시지를
  보여준다.** 운영용 화면이라 빈 화면보다 원인이 보이는 편이 낫다.
- `getJobDetail`이 `null`이면 `notFound()` → `app/jobs/[id]/not-found.tsx`.
- 북마크 실패는 낙관적 UI를 되돌리고 오류를 표시한다. **삼키지 않는다** —
  저장된 줄 알게 되는 것이 이 프로젝트에서 반복해 잡아온 실패 유형이다.
- 더 불러오기 실패는 재시도 버튼을 노출한다. 자동 재시도는 하지 않는다.

## 11. 테스트

- **계약 테스트** — 새 메서드 4개를 `MemoryStore`·`SupabaseStore` 양쪽에서
  검증한다. 특히 커서 페이징은 **동점 경계에서 누락·중복이 없는지**를 고정한다.
  이 테스트가 없으면 §5의 근거가 코드에 남지 않는다.
- **순수 함수 분리** — 통계 도출, 경고 판정(7일 경과), 축 막대 비율 계산을
  컴포넌트 밖으로 빼고 단위 테스트한다.
- **`startRun` 시그니처 변경**에 따른 기존 테스트 수정.
- 렌더링 테스트는 하지 않는다. 개인용 읽기 화면이고, 로직은 전부 위 두 층에서
  검증된다.

## 12. 범위 밖 (기록)

- 설정 편집, 수동 실행 버튼, 숨김 토글, 재채점 트리거
- 페이지네이션 UI(무한스크롤로 대체), 검색, 정렬 변경
- 실시간 갱신, 낙관적 캐시, 다크모드
- `conditions` 축 보강(루브릭 v4)과 168건 재채점 — 별건이다
- `listJobsNeedingScore`의 tie-break 부재 — 별건이며 한 줄 수정이다

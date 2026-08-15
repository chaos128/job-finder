# Job Finder — 설계 문서

- 작성일: 2026-08-15
- 상태: 승인됨 (구현 계획 대기)

## 1. 목적

Wanted에 올라오는 채용 공고를 매일 자동으로 수집하고, 내 이력서와 비교해 점수를 매긴 뒤,
맞는 공고가 있으면 이메일로 알린다.

수동으로 채용 사이트를 뒤지는 일을 없애는 것이 목적이며, 판단 자체를 대신하는 것이 아니라
**읽을 가치가 있는 공고를 골라주는 것**이 목표다.

## 2. 범위

### 포함

- Wanted 공고 수집 (검색 URL 기반, 여러 개 등록 가능)
- 이미 본 공고는 재수집하지 않음 (신규만)
- 이력서 프로필과 대조한 0~100점 채점 + 항목별 근거
- 조건 충족 시 하루 1통 이메일 다이제스트
- 웹 대시보드: 공고 목록·상세 근거, 검색 URL 관리, 프로필·알림 설정, 관심/숨김, 수동 실행

### 제외 (이번 범위 아님)

- **멀티유저** — 개인 용도로 시작한다. 스키마에 `user_id`를 넣지 않는다.
  나중에 필요해지면 3개 테이블에 컬럼 추가 + RLS 정책 작성으로 확장한다.
- **Wanted 외 소스** (remember 등) — `JobSource` 인터페이스로 확장 지점만 열어둔다.
- 지원서 자동 제출, 이력서 자동 생성

### 비기능 요구

- 개인 도구 수준의 신뢰성. 하루 실패해도 다음 날 따라잡으면 된다.
- 외부 API에 대해 보수적으로 동작한다 (동시성 제한, 백오프).
- 운영 비용 최소화. 채점은 구독(Claude Code routine)으로 수행한다.

## 3. 아키텍처

### 3.1 전체 흐름

```
Vercel Cron  01:00 ─▶ ① discover   ② fetchDetail      LLM 없음 · 무료
                          │
                          ▼  jobs 테이블에 채점 대기분이 쌓임
                          │
Claude Code  02:00 ─▶ ③ score                          구독 · routine
   routine                 GET  /api/scoring/pending
                           1건씩 앵커 루브릭으로 채점
                           POST /api/scoring/results
                           │
                           ▼
Vercel Cron  09:00 ─▶ ④ notify                         Resend

로컬 CLI (1회)  ─▶ 최초 백필 (현재 약 168건)
```

시각은 모두 **KST**다. 새벽에 수집·채점을 끝내고 업무 시작 시각에 메일이 도착한다.

**Vercel Cron은 UTC로 동작한다.** `vercel.json`에는 KST에서 9시간을 뺀 값을 넣어야 한다.

| 작업 | KST | UTC | cron 식 |
| --- | --- | --- | --- |
| collect (①②) | 01:00 | 16:00 (전날) | `0 16 * * *` |
| notify (④) | 09:00 | 00:00 | `0 0 * * *` |

routine(③)의 스케줄 타임존은 설정에서 KST로 지정한다.
세 작업 사이에 순서 의존성이 없으므로(§3.2) 시각이 밀려도 다음 날 따라잡는다.

### 3.2 스케줄러가 3개인데 handshake가 없는 이유

각 노드의 작업 대상은 **상태 전이가 아니라 질의**로 정의된다 (§5.2).
따라서 `notify`는 "채점됐고 아직 안 보낸 것"을 찾을 뿐이며,
routine이 늦거나 실패하면 그날은 발송하지 않고 다음 날 자동으로 따라잡는다.

세 스케줄러는 서로의 완료를 기다리지 않는다.

### 3.3 그래프

```
                    ┌──────────┐
  search config ───▶│ discover │──▶ JobRef[]        search 1개 단위 · fan-out
                    └──────────┘
                          │
                    ┌─────▼──────┐
       JobRef ─────▶│ fetchDetail│──▶ JobDetail     job 1건 단위
                    └────────────┘
                          │
                    ┌─────▼─────┐
JobDetail+Profile ─▶│   score   │──▶ ScoreResult    job 1건 단위
                    └───────────┘
                          │
                    ┌─────▼─────┐
  ScoredJob[] ─────▶│  notify   │──▶ EmailSent      run 1회 단위 · fan-in
                    └───────────┘
```

## 4. 노드

### 4.1 R&R

| 노드 | 책임 | 명시적으로 하지 않는 것 |
| --- | --- | --- |
| `discover` | 검색 URL로 목록 API 페이징, 외부 id 수집, 신규 판별 | 상세를 가져오지 않는다. 점수를 모른다. |
| `fetchDetail` | 외부 id → JD 본문 정규화 | 어떤 검색이 찾았는지 모른다. |
| `score` | JD + 프로필 → 점수·근거 | HTTP를 하지 않는다. 임계값을 판단하지 않는다. |
| `notify` | 알림 규칙 통과분을 1통으로 묶어 발송 | 채점하지 않는다. 수집하지 않는다. |

노드는 **자기 입력만 알고 다음 노드를 모른다.** 연결은 runner가 한다.
그래서 `score`는 Wanted를 몰라도 되고, 소스가 추가되어도 `discover`/`fetchDetail`만 바뀐다.

### 4.2 계약

```ts
type NodeError = {
  code: string
  message: string
  cause?: unknown
}

type NodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: NodeError; retryable: boolean }

interface Node<In, Out> {
  readonly name: string
  run(input: In, ctx: Ctx): Promise<NodeResult<Out>>
}
```

**노드는 throw하지 않는다.** `retryable` 판정은 노드가 한다 —
외부 API의 사정을 아는 것은 노드뿐이기 때문이다.

### 4.3 runner

runner의 책임은 노드의 책임과 분리된다.

- 작업 대상 질의 실행
- 동시성 제한 (외부 API는 3)
- 건별 실행 결과를 `node_runs`에 기록
- 건별 실패가 run 전체를 죽이지 않도록 격리

백필을 로컬로 분리했으므로 **중단·재개(deadline) 로직은 넣지 않는다.**
하루 처리량이 3~5건이라 Vercel 함수 제한에 여유가 있다.
필요해지면 그때 추가한다.

## 5. 데이터 모델

### 5.1 테이블

```
searches
  id, url, params jsonb, enabled bool, created_at

jobs
  id, source, external_id UNIQUE(source, external_id)
  position, company_name, company_id, address jsonb, url, due_time
  intro, requirements, main_tasks, preferred_points, benefits
  skill_tags jsonb, raw jsonb
  first_seen_at
  detail_status ('pending' | 'ok' | 'failed'), detail_attempts, detail_error
  bookmarked bool, hidden bool

search_hits
  search_id, job_id                      PK(search_id, job_id)

profile                                  싱글톤 (1행)
  id, resume_text, rubric_version, notify_email, notify_rule jsonb, updated_at

scores
  job_id PK
  total int, breakdown jsonb, reasoning text
  scorer ('routine' | 'api'), rubric_version
  status ('ok' | 'failed'), attempts, error
  scored_at, notified_at

notifications
  id, status ('pending' | 'sent' | 'failed'), job_ids jsonb,
  created_at, sent_at, error

runs
  id, trigger ('cron' | 'manual' | 'cli'), started_at, ended_at

node_runs
  id, run_id, node, item_id, status, duration_ms, error
```

### 5.2 상태 기계를 쓰지 않는다

각 노드의 작업 대상은 status 전이가 아니라 **질의**로 정의된다.
같은 노드를 몇 번 돌려도 결과가 같으므로(멱등) 중단·재실행이 안전하다.

| 노드 | 작업 대상 질의 |
| --- | --- |
| `discover` | `searches WHERE enabled = true` |
| `fetchDetail` | `jobs WHERE detail_status = 'pending' AND detail_attempts < 3` |
| `score` | `jobs WHERE detail_status = 'ok'`, `scores`에 행이 없거나 `status='failed' AND attempts < 3` |
| `notify` | 알림 규칙(§8) 통과 + `notified_at IS NULL`, 그리고 `notifications WHERE status='pending'` |

### 5.3 설계 근거

- **`scores.rubric_version`** — 루브릭을 고치면 이전 점수와 눈금이 달라진다.
  버전이 없으면 정렬이 오염된 것을 알아챌 수 없다.
  `job_id`가 PK이므로 **재채점은 기존 행을 덮어쓴다**(이력을 남기지 않는다).
  루브릭을 올린 뒤 과거 공고를 다시 채점할지는 수동 판단이며, 대시보드에서
  "구 버전으로 채점된 건수"를 노출해 결정할 수 있게 한다.
- **`scores.breakdown`** — 총점만 저장하면 채점 눈금이 흔들려도 감지할 수 없다.
  축별 점수를 남기면 특정 축이 후해지는 것이 보인다.
- **`scores.scorer`** — routine 채점과 API 채점이 섞였을 때 구분한다.
- **`jobs.raw`** — Wanted 응답 원본. 스키마 변경 시 재파싱할 수 있다.

## 6. 외부 인터페이스

### 6.1 Wanted API (2026-08-15 확인)

인증 없이 접근 가능. HTML 파싱이나 headless 브라우저가 필요 없다.

**목록**

```
GET https://www.wanted.co.kr/api/v4/jobs
  ?country=kr
  &tag_type_ids={직무 id}
  &job_sort=job.latest_order
  &years={from}&years={to}
  &locations={...}&locations={...}
  &limit=100&offset=0
```

- 페이징은 응답의 `links.next`를 따라간다.
- **`years` 상한은 10이다.** UI가 만들어주는 `years=20`은 422로 거부된다.
  ```json
  {"errors": {"years": {"1": ["Not a valid choice."]}}}
  ```
  URL 파싱 단계에서 상한을 클램프한다.
- 응답에 **게시일 필드가 없다** (`due_time` 마감일만 존재).
  따라서 신규 판별은 저장된 `external_id`와의 diff로 한다.

**상세**

```
GET https://www.wanted.co.kr/api/v4/jobs/{id}
```

응답 `job.detail`에 JD가 구조화되어 들어온다:
`requirements`, `main_tasks`, `intro`, `benefits`, `preferred_points`.
`job.skill_tags`에 스킬 목록(`{title, id, kind_title}`)이 별도로 온다.

**참고 수치** — 사용자의 초기 필터(직무 669, 연차 8~10, 서울·경기 9개 지역) 기준 총 168건.

### 6.2 채점 엔드포인트

routine이 Supabase에 직접 붙지 않게 한다. DB 자격증명이 에이전트 환경에 들어가지 않고,
**HTTP 스키마가 계약**이 되어 나중에 API 채점으로 전환해도 서버 쪽 변경이 없다.

```
GET  /api/scoring/pending      Authorization: Bearer {SCORING_TOKEN}
  → { profile: { resume_text, rubric_version },
      rubric: string,
      jobs: [{ id, position, company_name, requirements, main_tasks,
               preferred_points, benefits, skill_tags, url }] }

POST /api/scoring/results      Authorization: Bearer {SCORING_TOKEN}
  ← [{ job_id, total, breakdown: { [axis]: number }, reasoning }]
  → { accepted: number, rejected: [{ job_id, reason }] }
```

**응답은 zod로 검증한다.** 형식이 어긋난 채점은 거부하고 `scores.status='failed'`로 남긴다.
에이전트 출력이 흔들려도 쓰레기 데이터가 들어오지 않는다.

## 7. 채점

### 7.1 채점 주체

Claude Code scheduled routine이 구독으로 수행한다. API 종량 과금을 쓰지 않는다.

### 7.2 일관성 확보 장치

에이전트 채점은 API 호출보다 눈금이 흔들리기 쉽다. 다음 네 가지로 억제한다.

1. **앵커 루브릭** — 축마다 0/10/20점이 어떤 상태인지 문장으로 못박는다.
   레포의 `packages/scoring/rubric.md` 한 곳에서 관리하고 routine이 매번 읽는다.
2. **1건씩 채점** — 한 실행에서 여러 건을 한꺼번에 보면 앞 공고가 뒤 공고의 기준점이 된다.
3. **breakdown 저장** — 축별 점수를 남겨 눈금 이동을 감지한다.
4. **상대 순위 알림** (§8) — 절대 임계값을 쓰지 않아 눈금이 흔들려도 알림 양이 튀지 않는다.

### 7.3 루브릭 v1

5개 축 × 0~20점 = 100점. 아래는 초안이며, §11의 eval로 검증 후 확정한다.

| 축 | 0점 | 10점 | 20점 |
| --- | --- | --- | --- |
| 기술 스택 적합도 | 주력 스택과 거의 겹치지 않음 | 절반 정도 겹치고 나머지는 학습 가능 | requirements 대부분이 내 주력 |
| 역할·직급 적합도 | 연차/기대 역할이 명백히 어긋남 | 범위에 걸치나 일부 불일치 | 연차·책임 범위가 정확히 맞음 |
| 도메인 적합도 | 경험 없는 도메인이고 이전성도 낮음 | 인접 도메인, 경험 일부 이전 가능 | 직접 경험한 도메인 |
| 성장·기술적 도전 | 단순 유지보수, 배울 것이 거의 없음 | 일부 새로운 영역 존재 | 명확한 기술적 난제와 성장 여지 |
| 근무 조건 | 프로필의 선호 조건과 충돌 | 무난하나 특별한 이점 없음 | 위치·규모·조건이 선호와 부합 |

루브릭을 수정하면 `rubric_version`을 올린다.

### 7.4 프로필

`resume.pdf`를 Claude로 **1회 파싱**해 구조화된 텍스트 프로필로 만들고 `profile.resume_text`에 저장한다.
이후 채점은 이 텍스트만 사용한다.

대시보드에서 직접 편집할 수 있게 한다 — PDF에 없는 맥락(원하는 회사 규모, 기피 기술, 이직 사유 등)을
덧붙이면 채점 품질이 올라가며, 이는 루브릭의 `근무 조건`·`도메인` 축이 참조하는 정보다.

## 8. 알림

### 8.1 규칙

**그날 채점분 중 상위 3건, 그중 60점 이상**만 발송한다. 0건이면 메일을 보내지 않는다.

절대 임계값(예: 70점 이상)을 쓰지 않는 이유: 에이전트 채점의 눈금이 몇 점만 이동해도
알림 양이 0통↔20통으로 튄다. 상대 순위는 그 변동을 흡수한다.

규칙은 `profile.notify_rule`에 저장하고 대시보드에서 조정한다.

### 8.2 중복/누락 방지

"발송 후 표시"는 중복 발송, "표시 후 발송"은 영구 누락 위험이 있다.
`notifications` 테이블을 한 단계 둔다.

```
INSERT notifications(status='pending', job_ids)
  → Resend 발송
  → UPDATE status='sent', scores.notified_at 갱신
```

발송이 실패하면 행이 `pending`으로 남고, 다음 run이 그 행을 먼저 처리한다.
다른 노드와 동일하게 "작업 대상 = 질의" 패턴이라 별도 재시도 로직이 없다.

## 9. 에러 / 재시도

| 상황 | 판정 | 처리 |
| --- | --- | --- |
| Wanted 5xx / 429 / 타임아웃 | retryable | `attempts++`, 다음 run에서 재시도 (최대 3) |
| Wanted 404 (공고 삭제) | 영구 | attempts를 상한으로 올려 제외, error 기록 |
| Wanted 422 (파라미터 오류) | 영구 | 해당 search를 비활성화 + 대시보드에 경고 |
| 채점 결과 스키마 불일치 | retryable | 거부하고 `scores.status='failed'`, attempts++ |
| 채점 3회 실패 | 영구 | 대시보드에 노출, 수동 확인 |
| Resend 발송 실패 | retryable | `notifications`가 `pending`으로 남아 다음 run이 재시도 |

- Wanted 호출은 **동시성 3 + 지수 백오프**. 개인 프로젝트가 남의 API를 두드리는 것이므로 보수적으로 잡는다.
- 부분 실패는 run을 죽이지 않는다. run은 항상 완료되고 건별 결과는 `node_runs`에 남는다.

## 10. 프로젝트 구조

```
apps/
  web/                          Next.js App Router + shadcn
    app/(dashboard)/            공고 목록·상세 / 검색 URL 관리 / 프로필·알림 설정
    app/api/cron/collect        ① discover ② fetchDetail
    app/api/cron/notify         ④ notify
    app/api/scoring/pending     routine → 채점 대기분 조회
    app/api/scoring/results     routine → 채점 결과 수신 (zod 검증)
    app/api/run                 대시보드 수동 실행
packages/
  graph/                        Node 계약 + runner + node_runs 기록
  sources/                      JobSource 인터페이스 + wanted 어댑터
  scoring/                      rubric.md + zod 스키마 + 프로필 파서
  db/                           Supabase 클라이언트 + 생성 타입 + 마이그레이션
  mailer/                       Resend + 다이제스트 템플릿
tools/
  backfill/                     로컬 CLI (최초 1회)
```

Turborepo를 쓰는 근거는 하나다: `apps/web`과 `tools/backfill`이 **같은 packages를 공유**해야
"백필과 증분이 동일 코드 경로"라는 약속이 성립한다.

### 확장 지점

```ts
interface JobSource {
  readonly id: 'wanted' | 'remember'
  parseSearchUrl(url: string): SearchParams
  listRefs(params: SearchParams): AsyncIterable<ExternalRef>
  fetchDetail(ref: ExternalRef): Promise<RawDetail>
  normalize(raw: RawDetail): JobDetail
}
```

소스를 추가할 때 이 인터페이스만 구현하면 `discover`/`fetchDetail`이 그대로 동작한다.

### 인증

Supabase Auth 매직링크 + 계정 1개. 이력서가 공개 URL에 노출되지 않게 하는 것이 목적이며,
멀티유저로 확장할 때의 자연스러운 경로이기도 하다.

### 환경 변수

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY     # cron / worker
RESEND_API_KEY
CRON_SECRET                   # Vercel cron 엔드포인트 인증
SCORING_TOKEN                 # routine ↔ 채점 엔드포인트
ANTHROPIC_API_KEY             # 지금은 불필요. API 채점으로 전환할 때만 추가한다.
```

이력서 파싱은 Claude Code에서 대화형으로 1회 수행하므로 API 키가 들어가지 않는다.
**운영 채점은 구독(routine), 1회성 작업은 대화형 세션** — 종량 과금이 쓰이는 곳이 없다.

## 11. 테스트 전략

- **`sources/wanted`** — 실제 응답을 fixture로 고정(목록 JSON, 상세 JSON).
  파싱·정규화·URL 파싱(특히 `years=20` 클램프)을 검증한다.
  Wanted가 스키마를 바꾸면 여기가 먼저 실패한다.
  fixture는 구현 시작 시점에 다시 받아 레포에 커밋한다(설계 중 확인한 응답은 임시 파일이라 보존되지 않음).
- **`graph/runner`** — 세 가지를 고정한다:
  1. 건별 실패가 run을 죽이지 않는가
  2. 재시도 상한을 지키는가
  3. **같은 노드를 두 번 돌려도 중복이 생기지 않는가 (멱등성)** — §5.2 설계 전체의 근거
- **`scoring`** — zod 스키마 검증(형식 불일치 거부). 품질은 별도 eval로 확인한다:
  손으로 라벨링한 공고 10건(좋음 5 / 나쁨 5)을 돌려 **순위가 맞는지** 본다.
  루브릭이나 프롬프트를 고칠 때마다 실행한다. 절대 점수가 아니라 순위를 본다.
- **E2E** — 로컬 Supabase에 fixture 시딩 → `/api/run` 호출 → 최종 이메일 payload 스냅샷 비교.
  HTTP와 채점은 스텁.

## 12. 결정 기록

| 결정 | 대안 | 이유 |
| --- | --- | --- |
| Wanted v4 JSON API 직접 호출 | HTML 파싱 / headless 브라우저 | API가 인증 없이 열려 있고 JD가 이미 구조화되어 옴. 브라우저가 필요 없으니 serverless로 충분. |
| 신규 판별을 `external_id` diff로 | 게시일 비교 | 응답에 게시일 필드가 없다. |
| 상태 기계 대신 질의 기반 | `status` 컬럼 전이 | 멱등성이 공짜로 따라온다. 중단·재실행이 안전하다. |
| 채점을 routine(구독)으로 | Claude API 종량 과금 | 단일 계정 기준 월 $1~3(모델에 따라)을 아낀다. 대가인 눈금 편차는 앵커 루브릭 + 상대 순위 알림으로 억제. |
| 백필을 로컬 CLI로 분리 | Vercel에서 deadline 루프로 처리 | 168건은 함수 제한에 안 들어간다. 로컬로 빼면 일일 경로가 3~5건이라 재개 로직 자체가 불필요해진다. |
| 상대 순위 알림 | 절대 임계값 | 에이전트 채점의 눈금 이동에 알림 양이 휘둘리지 않는다. |
| 멀티유저 제외 | 처음부터 `user_id` + RLS | 개인 용도로 시작. 확장 비용이 마이그레이션 1회로 작다. |
| routine ↔ HTTP 엔드포인트 | routine이 Supabase 직접 접근 | DB 자격증명이 에이전트 환경에 안 들어간다. HTTP 스키마가 계약이 되어 API 채점 전환 시 서버 변경이 없다. |

## 13. 열린 항목

1. **routine에 `SCORING_TOKEN`을 주입하는 방법** — cloud routine의 시크릿 전달 방식을 구현 시점에 확인한다.
   설계상 외부 종속성은 토큰 하나뿐이라 방식이 무엇이든 흡수된다.
2. **`resume.pdf` 파싱** — `brew install poppler` 후 Claude Code에서 PDF를 직접 읽어
   프로필을 만들고 `profile.resume_text`에 넣는다. 스크립트도 API 키도 필요 없다. *(해결됨)*
3. **루브릭 v1 확정** — §7.3은 초안이다. 프로필 파싱 후 eval 10건으로 검증하고 조정한다.
4. **Vercel 요금제** — Hobby 기준(cron 1일 1회, 함수 60초)으로 설계했다.
   collect / notify를 하루 2회 실행하므로 요금제 제약을 확인해야 한다.
   제약이 있으면 collect와 notify를 한 cron으로 합친다 (질의 기반이라 순서 의존성이 없어 안전).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 무엇을 하는 서비스인가

Wanted 채용 공고를 크롤링해 소유자의 이력서와 대조 채점하고, 좋은 매치가 나오면 매일 이메일
다이제스트를 보낸다. 1인 개인용이며 Supabase(단일 프로젝트) + Vercel cron으로 돈다.

설계 문서: [docs/superpowers/specs/2026-08-15-job-finder-design.md](docs/superpowers/specs/2026-08-15-job-finder-design.md)
운영 메모(배포 전제조건·감수한 한계): [docs/operations.md](docs/operations.md)

## 명령어

```bash
pnpm test                        # 전체 테스트 (루트 vitest)
pnpm vitest run packages/db/test/memory-store.test.ts   # 단일 파일
pnpm vitest run -t "멱등"         # 이름으로 필터
pnpm typecheck                   # turbo, 워크스페이스 전체
pnpm build
pnpm backfill                    # 로컬 전량 수집 CLI (cron 없이)
```

**`pnpm -r test`를 쓰지 마라.** 워크스페이스에는 `test` 스크립트가 없다. 테스트는 루트
`vitest.workspace.ts` 하나가 전부 관장하므로, `-r`은 아무것도 실행하지 않고 조용히 성공한다.

## 아키텍처에서 먼저 알아야 할 것

### 채점은 이 앱이 하지 않는다

웹 앱은 LLM을 호출하지 않는다. 외부 Claude Code routine(구독)이
`GET /api/scoring/pending`으로 대기 공고를 받아 채점하고 `POST /api/scoring/results`로
돌려준다. 유료 API를 쓰지 않으려는 의도적 선택이다.
routine 프롬프트: [docs/routine-prompt.md](docs/routine-prompt.md)

따라서 채점 품질은 코드가 아니라 **루브릭 문구**와 `profile.resume_text`가 좌우한다.
루브릭은 `packages/scoring/src/rubric.ts`에 **인라인 문자열로** 들어 있다 —
`rubric.md`를 런타임에 읽으면 빌드된 Next 앱에서 ENOENT로 죽기 때문이다.
두 파일이 어긋나지 않도록 드리프트 테스트가 바이트 동일성을 강제한다. 둘 다 같이 고쳐라.

### 작업 대상은 상태 머신이 아니라 SQL 질의다

각 노드의 처리 대상은 "status가 X인 행"을 고르는 **질의**로 정의된다
(`listJobsNeedingDetail`, `jobs_needing_score` 뷰, `listPendingNotifications`).
이게 멱등성의 근거다 — 같은 실행을 몇 번 반복해도 안전하고, 실패한 건은 다음 실행이
자연히 다시 집는다. 상태 전이를 추가하는 방향으로 리팩터링하지 마라.

**단, 이 보장은 순차 재실행에만 적용된다.** 겹치는 동시 실행(cron과 `/api/run`)은
보호되지 않는다.

### 회사 별점은 Blind HTML을 긁어 온다

`packages/sources/src/blind/index.ts`가 teamblind.com 검색 결과를 파싱한다. 공개 API가
없어 마크업(`class="name"` 앵커 + 뒤따르는 `class="star"` 스팬)에 의존한다 — 마크업이
바뀌면 `packages/sources/test/blind.test.ts`의 실제 응답 픽스처가 먼저 깨져야 한다.
**파싱 실패와 "Blind 미등록"을 구분하지 않으므로**, 이 테스트가 통과하는 한에서만
"별점이 안 보인다 = 그 회사가 Blind에 없다"로 읽을 수 있다.

회사명 매칭은 완전하지 않다(실측 187곳 중 104곳, 56%). `searchCandidates`가 원문 →
괄호 앞 → 괄호 안 순으로 시도해 끌어올린 값이다. 미등록으로 확정된 회사도 행으로
남긴다 — 안 그러면 매 실행이 없는 회사를 영원히 다시 조회한다.

별점은 **채점에 반영하지 않는다.** 루브릭을 건드리면 기존 전량을 재채점해야 하고,
커버리지가 56%라 없는 회사가 일괄 감점되는 왜곡이 생긴다.

### 소스는 둘이고, 노드가 행마다 고른다

`packages/sources/src/{wanted,remember}/`가 각각 `JobSource`를 구현하고,
`createSourceRegistry()`가 `Partial<Record<Source, JobSource>>`로 묶는다. discover는
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

### 목록은 제외 여부로 갈린다

`listDashboardJobs`는 한 번에 한쪽만 준다 — 기본은 제외되지 않은 것, `hiddenOnly`면
제외된 것만. 한 페이지에 두 값이 섞이지 않으므로 질의도 하나다.

예전에는 "전체를 주되 제외분을 뒤로" 정렬하느라 버킷 두 개를 이어붙였다. PostgREST의
`or()`/`and()` 로직 트리 파서가 임베드 컬럼 참조(`jobs.hidden`)를 받지 못해 커서에
섞을 수 없었기 때문인데, 목록이 갈린 뒤로는 필요가 없어져 걷어냈다.

`DashboardCursor.hidden`은 그래서 정렬 키가 아니라 **소속 표시**다. 필터를 바꾸면
이전 목록의 커서가 남는데, 소속이 다른 커서를 그대로 태우면 반대편 목록의 앞부분이
통째로 잘린다 — 두 스토어 모두 소속이 다르면 커서를 버린다.

### 마감은 저장된 날짜가 아니라 다시 물어서 판단한다

수집 cron의 `recheck` 노드가 제외되지 않은 공고의 상세를 다시 불러 `status`를 본다.
`'close'`일 때만 제외하고, 모르는 값이면 열린 것으로 둔다 — 표기가 바뀌었을 때
멀쩡한 공고를 무더기로 숨기지 않기 위해서다.

**저장된 `due_time`으로 판단하면 틀린다.** 실측(마감일이 지난 비제외 7건을 다시 조회):
2건이 여전히 `active`였고 그중 하나는 마감이 09-10에서 09-27로 **연장**됐다. 반대로
마감일이 미래인데 `status`가 `close`인 건도 있었다. 게다가 240건 중 198건이
상시채용(`due_time` 없음)이라 날짜로는 아예 판단할 수 없다. 그래서 `due_time`은
판단이 아니라 **표시용**이고, 재확인 때마다 최신값으로 덮는다.

**삭제하지 않는다.** `scores`가 `on delete cascade`라 손으로 매긴 채점이 함께 사라지고,
`notifications.job_ids`는 FK가 아니라 지난 다이제스트의 링크가 깨진다. 재등록을 놓칠
걱정도 없다 — 같은 공고가 다시 올라오면 Wanted가 **새 `external_id`**를 주므로
(실측 7쌍 전부) 새 행으로 들어와 정상 수집·채점된다.

`saveJobDetail`이 `rechecked_at`을 함께 남기는 이유: 상세를 받은 것 자체가 확인이다.
안 남기면 방금 수집한 공고가 같은 실행의 재확인 노드에 잡혀 같은 API를 또 부른다.

### 50점 이하는 채점 직후 자동으로 제외된다

`/api/scoring/results`가 점수를 저장한 뒤 `total <= AUTO_HIDE_MAX_SCORE`(50)면
`setJobHidden(jobId, true)`를 부른다. 제외된 공고는 사라지지 않고 목록 맨 뒤로 내려가
회색으로 표시되므로, 되돌리기 버튼으로 언제든 올릴 수 있다.

**올리기만 하고 내리지 않는다.** 51점 이상이라고 제외를 푸는 분기를 넣으면 손으로
제외해 둔 공고가 재채점 때 되살아난다 — 자동화가 사람의 결정을 덮어쓰면 안 된다.

숨김 호출은 `saveScore`의 try 밖(자기 catch)에 있어야 한다. 안에 두면 숨김 실패가
`recordScoreFailure`를 불러 **방금 저장된 멀쩡한 점수를 `status='failed'`로 덮어쓴다.**

### 경력 요건은 화면 문구가 아니라 정수 두 칸이다

`jobs.annual_from` / `annual_to`(0007)는 Wanted 상세 API가 주는 원본 그대로다.
화면의 "경력 5년 이상"은 **저장된 값이 아니라 Wanted 프론트엔드가 두 정수로 만들어
그리는 문구**라, API 응답 어디에도 없다(운영 raw를 뒤져 확인했다 — "경력"이 들어간
문자열은 전부 JD 본문이다). 그래서 변환은 어차피 필요하고, 렌더 시점에 둔다
(`apps/web/app/jobs/_components/experience.ts`). 저장해 두면 표기를 고칠 때마다
전 행을 다시 만들어야 한다.

`annual_to = 100`은 **"상한 없음" 센티널**이고 `annual_from = 0`은 신입 포함이다.
그대로 쓰면 "경력 5-100년"이 나간다. 표기 규칙 일곱 가지는 실제 공고 페이지와
대조해 `apps/web/test/experience.test.ts`에 박아뒀다.

### 노드는 절대 throw하지 않는다

`packages/graph/src/core/node.ts`의 `Node<In,Out>`는 `NodeResult`를 반환한다
(`ok` / `fail(code, message, retryable)`). `runNode`는 공유 커서 기반 워커 풀(기본 동시성 3)로,
건별 실패를 격리하고 `node_runs`에 기록한다. 새 노드를 추가하면 이 계약을 따라라.

`retryable` 필드는 **현재 어디서도 소비되지 않는다**(유일 소비처가 백필 CLI의 로그 한 줄).
실제 재시도는 전적으로 DB의 status/attempts가 만든다. 이 필드를 고쳐서 동작을 바꾸려 하지 마라.

### Store는 포트이고 구현이 둘이다

`packages/db/src/store.ts`가 인터페이스, `memory-store.ts`(테스트)와
`supabase-store.ts`(운영)가 구현이다. 둘은 `packages/db/test/store-contract.ts` 하나로
함께 검증된다. **인터페이스를 바꾸면 세 파일이 같이 움직여야 한다.**

PostgREST 특성 때문에 두 구현이 갈리기 쉬운 지점: `ON CONFLICT DO NOTHING` + `RETURNING`,
1:1 embed는 배열이 아니라 객체, `merge-duplicates` upsert는 생략한 컬럼을 보존.

### 마이그레이션은 수동 적용이다

러너가 없다. `packages/db/migrations/*.sql`을 사람이 Supabase 대시보드 SQL Editor에서
실행한다. **적용된 마이그레이션 파일을 수정하지 마라** — 새 파일을 만들고 `if not exists`로
멱등하게 써라. 코드가 새 컬럼을 전제하면, 적용 전 동작이 어떻게 되는지도 함께 확인해야 한다.

RLS는 8개 테이블 전부 켜져 있고 **정책은 하나도 없다**(service_role만 통과, anon은 전면 차단).
`jobs_needing_score` 뷰는 `security_invoker = true`라 우회 통로가 되지 않는다.

## 함정

- **ESM `.js` → `.ts` 해석**: 워크스페이스 패키지의 상대 import가 `.js` 확장자로 `.ts`
  소스를 가리킨다. Next는 `next.config.ts`의 `webpack.resolve.extensionAlias`로,
  CLI는 `tsx`로 푼다. `node --experimental-strip-types`는 이걸 해석하지 못한다.
- **`packages/db/test/supabase-store.test.ts`는 대상 프로젝트의 모든 테이블을 비운다.**
  Supabase 프로젝트가 하나뿐이라 운영 데이터가 날아갈 수 있다. `SUPABASE_TEST_ALLOW_TRUNCATE=1`
  옵트인이 있어야만 돌고, 기본적으로는 skip된다. 지워도 되는 별도 프로젝트에서만 켜라.
- **`.env.local`은 저장소 루트에 있는데 Next는 `apps/web/`에서 찾는다.** 그래서
  `apps/web/.env.local`을 루트 파일로 향하는 심링크로 둔다(gitignore 대상이라 각자
  만들어야 한다). 없으면 `pnpm dev`가 뜨긴 하는데 모든 페이지가
  `NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다`로 500이 난다.
  ```bash
  ln -sf ../../.env.local apps/web/.env.local
  ```
- **Vercel cron은 UTC**. `apps/web/vercel.json`의 `0 16 * * *` / `0 0 * * *`는 KST 01:00 / 09:00이다.
- **cron 라우트의 HTTP 상태 코드가 유일한 능동 실패 신호다.** 건별 실패가 있거나 설정이
  누락되면 5xx를 반환한다(본문은 그대로 유지). 이 규약을 200으로 되돌리면 모든 장애가
  무음이 된다. 대시보드(`/`, `/jobs`)가 생겼지만 사람이 열어봐야 보이고, 채점 지연 등
  상태 스트립이 보여주는 것만 담는다 — 수집·발송 실패는 여전히 cron 로그가 유일한 창이다.
- `apps/web/lib/guard.ts`는 토큰 미설정 시 **500으로 닫는다**. 열어두지 않는다.
- `docs/profile.md`와 `resume.pdf`는 gitignore 대상(개인 정보). 채점의 실제 원천은
  DB의 `profile.resume_text`이므로, 파일을 고쳤으면 DB에도 다시 로드해야 한다.
- **교차 중복은 `hidden`이 아니라 `jobs.duplicate_of`로 표시한다.** `hidden`은 이미
  쓰는 주체가 셋이라(사람·저점수 자동·마감 자동) 네 번째가 끼면 "왜 안 보이는가"를
  되짚을 수 없다. 판정은 휴리스틱이므로 행을 지우지 않는다 — `/jobs`의 중복 토글로
  확인할 수 있다. **단, 토글은 보기만 할 뿐 되돌리지 못한다** — Store·서버 액션·UI
  어디에도 `duplicate_of`를 지우는 경로가 없다. 오탐을 고치려면 SQL Editor에서 직접
  지워야 한다(절차는 `docs/operations.md` 참고).

## 코드 관례

주석은 한국어로 쓰고 **"왜"를 설명한다** — 무엇을 하는지는 코드가 말한다.
특히 비직관적인 선택(위 함정들 같은)에는 근거 주석이 붙어 있다. 그 주석을 지우지 마라.

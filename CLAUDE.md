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
- **Vercel cron은 UTC**. `apps/web/vercel.json`의 `0 16 * * *` / `0 0 * * *`는 KST 01:00 / 09:00이다.
- **cron 라우트의 HTTP 상태 코드가 유일한 실패 신호다.** 대시보드가 없다. 건별 실패가
  있거나 설정이 누락되면 5xx를 반환한다(본문은 그대로 유지). 이 규약을 200으로 되돌리면
  모든 장애가 무음이 된다.
- `apps/web/lib/guard.ts`는 토큰 미설정 시 **500으로 닫는다**. 열어두지 않는다.
- `docs/profile.md`와 `resume.pdf`는 gitignore 대상(개인 정보). 채점의 실제 원천은
  DB의 `profile.resume_text`이므로, 파일을 고쳤으면 DB에도 다시 로드해야 한다.

## 코드 관례

주석은 한국어로 쓰고 **"왜"를 설명한다** — 무엇을 하는지는 코드가 말한다.
특히 비직관적인 선택(위 함정들 같은)에는 근거 주석이 붙어 있다. 그 주석을 지우지 마라.

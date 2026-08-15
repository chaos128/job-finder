# 운영 메모

배포 전에 반드시 해야 하는 것과, 알면서 남겨둔 한계.

## 배포 전 체크리스트

### 1. `0002_notification_attempts.sql` 적용 — **하드 블로커**

Supabase 대시보드 → SQL Editor에서 `packages/db/migrations/0002_notification_attempts.sql`을
실행한다. `if not exists`라 여러 번 돌려도 안전하다.

적용 전에는 `markNotificationFailed`가 없는 컬럼에 쓰려다 실패하고(PostgREST `PGRST204`),
그 예외는 `runNode`가 `UNCAUGHT`로 흡수한다. 결과적으로 알림이 `pending`에 남아
**영구 실패 알림 하나가 이후 모든 다이제스트를 막는 상태**가 그대로 유지된다.
이 마이그레이션이 그 게이트를 푸는 유일한 수단이다.

### 2. 발송 설정에 실제 값이 들어갔는지 확인

| 항목 | 확인 방법 | 비어 있으면 |
| --- | --- | --- |
| `profile.notify_email` | `select notify_email from profile` | notify가 skip하고 cron이 **500**을 반환한다 |
| `NOTIFY_FROM` | Vercel 환경변수 | 기본값 `onboarding@resend.dev`는 Resend 계정 소유자 주소로만 배달된다 |

Resend에서 도메인을 검증하지 않으면 계정 소유자 본인 주소 외에는 발송이 거부된다
(403 `validation_error`). 다른 주소로 받으려면 resend.com/domains에서 도메인을 검증하고
`NOTIFY_FROM`을 그 도메인 주소로 지정해야 한다.

### 3. Vercel 환경변수

`CRON_SECRET`, `SCORING_TOKEN`, `SUPABASE_*`, `RESEND_API_KEY`, `NOTIFY_FROM`.
`lib/guard.ts`는 토큰이 없으면 **500으로 닫는다**(열어두지 않는다). 누락되면 모든 라우트가 죽는다.

크론은 UTC로 돈다. `vercel.json`의 `0 16 * * *`(collect) / `0 0 * * *`(notify)는
각각 KST 01:00 / 09:00이다.

### 4. 첫 notify 실행은 눈으로 확인

`0002` 적용 후 첫 실행의 응답과 Vercel 로그를 한 번은 직접 본다.

## 실패를 어떻게 알아채는가

대시보드가 없다(Plan 2). **cron 라우트의 HTTP 상태 코드가 유일한 신호다.**

- `200` — 정상. 발송했거나, 후보가 없어 쉬었다(`skipped: 'no candidates above threshold'`).
- `500` — 사람이 봐야 한다. 건별 실패가 있거나, `notify_email`이 비어 있다.

Vercel cron 로그에서 500을 확인하고, 응답 본문의 `failed` 배열을 읽으면 된다
(장애 중에도 부분 결과를 볼 수 있도록 본문은 500일 때도 그대로 반환한다).

## 알면서 남겨둔 것

전부 최종 리뷰에서 판정한 뒤 의도적으로 남긴 것들이다.

| 항목 | 현상 | 왜 안 고쳤나 |
| --- | --- | --- |
| Resend idempotency 24시간 만료 | 아주 드물게 다이제스트 1통 중복 | 2단계 커밋은 개인용 도구에 과하다 |
| `runs.started_at`/`ended_at` 시계 불일치 | `runs` 기준 소요시간이 음수로 보일 수 있음 | 관측용 컬럼이고 소비처가 없다. `node_runs.duration_ms`는 영향 없음 |
| Wanted 422 시 search 자동 비활성화 없음 | 태그 체계가 바뀌면 수집이 멈춤 | 재활성화할 대시보드가 없어 자동 비활성화가 더 위험하다. cron 500으로 관측 가능 |
| `in()` 쿼리스트링 길이, `MAX_PAGES` 무음 절단 | 5000건 규모에서 발동 | 실측 168건. 검색 조건을 크게 넓히면 그때 고친다 |
| `profile.rubric_version` 미사용 | DB 컬럼이 미끼 | 루브릭 버전의 실제 원천은 코드 상수. 대시보드가 생기면 정리 |

## 개발 시 주의

- 테스트는 **루트에서** `pnpm test`. 워크스페이스에는 `test` 스크립트가 없어
  `pnpm -r test`는 아무것도 돌리지 않고 조용히 성공한다.
- `packages/db/test/supabase-store.test.ts`는 대상 프로젝트의 **모든 테이블을 비운다.**
  Supabase 프로젝트가 하나뿐이라 운영 데이터가 날아갈 수 있어 `SUPABASE_TEST_ALLOW_TRUNCATE=1`
  옵트인을 요구한다. 지워도 되는 별도 프로젝트에서만 쓸 것.
- 백필은 `pnpm backfill` (로컬 전용, cron 없이 전량 수집).

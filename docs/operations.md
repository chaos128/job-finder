# 운영 메모

배포 전에 반드시 해야 하는 것과, 알면서 남겨둔 한계.

## 배포 전 체크리스트

**순서가 중요하다: routine 프롬프트 재등록 → 마이그레이션 적용 → 앱 배포.**
이 순서는 한 방향으로만 안전하다(아래 1번).

### 1. routine 프롬프트 재등록 — **앱 배포보다 먼저**

`docs/routine-prompt.md`가 바뀌었으면 **배포 전에** Claude Code routine 콘솔의 프롬프트를
새 내용으로 교체한다. 콘솔에 등록된 것은 레포 파일의 **사본**이라, 레포를 고쳐도 따라오지
않는다.

왜 순서가 한 방향인가 (실측):

| 조합 | 결과 |
| --- | --- |
| 새 프롬프트 → 옛 앱 | 안전. `zod`의 `z.object`는 모르는 키를 기본으로 버린다(`.strict()`가 아니다) — 앱이 모르는 새 필드는 조용히 무시되고 저장은 성공한다 |
| 옛 프롬프트 → 새 앱 | **위험.** 새로 필수가 된 필드가 빠져 `parseScoreItem`이 실패 → 전건 `rejected` → `recordScoreFailure`가 `attempts`를 올린다 |

옛 프롬프트로 도는 경우가 왜 조용한 데이터 손실인가: `attempts`가 3에 닿으면
`jobs_needing_score`(`0001_init.sql`, `attempts < 3`)가 그 공고를 **영구히** 제외한다.
다시는 채점되지 않고 `/jobs`에도 영영 안 올라온다. 그런데 `/api/scoring/results`는
건별 거절을 본문에만 담고 **200**을 반환한다 — 이 저장소에서 유일한 실패 신호인 HTTP
상태 코드가 정상이라고 말한다. 한 번에 20건이므로 **사흘이면 최대 60건이 조용히 이탈한다.**

### 2. 마이그레이션 적용

러너가 없다. Supabase 대시보드 → SQL Editor에서 사람이 실행한다. 전부 `if not exists` /
`create or replace`라 여러 번 돌려도 안전하다.

| 파일 | 현재 운영 프로젝트 | 미적용 시 |
| --- | --- | --- |
| `0001_init.sql` | 적용됨 | 아무것도 안 돈다 |
| `0002_notification_attempts.sql` | 적용됨 | 아래 참조 — **하드 블로커** |
| `0003_runs_pipeline.sql` | 적용됨 | 대시보드의 "최근 실행"이 파이프라인을 "알 수 없음"으로만 표시 |
| `0004_scores_summary.sql` | 적용됨 | 아래 참조 — **하드 블로커** |
| `0005_jobs_unscored.sql` | **아직 아님** | 아래 참조 — 미채점 토글만 죽는다 |

새 환경(백업 복원, 두 번째 프로젝트)에서는 위 다섯 개를 번호순으로 전부 실행한다.
"현재 운영 프로젝트" 열은 이 저장소 소유자의 프로젝트 상태일 뿐 코드의 전제가 아니다.

**`0002` 미적용 시**: `markNotificationFailed`가 없는 컬럼에 쓰려다 실패하고(PostgREST
`PGRST204`), 그 예외는 `runNode`가 `UNCAUGHT`로 흡수한다. 결과적으로 알림이 `pending`에
남아 **영구 실패 알림 하나가 이후 모든 다이제스트를 막는 상태**가 그대로 유지된다.
이 마이그레이션이 그 게이트를 푸는 유일한 수단이다.

**`0004` 미적용 시**: `scores.summary` 컬럼이 없다. `DASHBOARD_SELECT`가 그 컬럼을
요청하므로 PostgREST 400 → **`/jobs` 목록 페이지 전체가 죽는다.** 게다가 `saveScore`도
`summary`를 쓰다 `PGRST204`로 실패해 모든 채점 제출이 rejected되고, 위 1번의 영구 이탈
경로를 그대로 탄다. 이 범위에서 가장 센 블로커다.

**`0005` 미적용 시**: `/jobs`의 "미채점 포함" 토글이 존재하지 않는 `jobs_unscored` 뷰를
조회하려다 PostgREST 404(관계 없음)를 받는다 — `loadUnscoredJobs` 서버 액션이 에러를
던지고 `UnscoredList`가 에러 배너를 보여준다(메시지가 프로덕션에서 지워지면 digest가
함께 찍힌다). 채점된 목록 자체는 이 뷰를 쓰지 않으므로 영향 없다.

### 3. 발송 설정에 실제 값이 들어갔는지 확인

| 항목 | 확인 방법 | 비어 있으면 |
| --- | --- | --- |
| `profile.notify_email` | `select notify_email from profile` | notify가 skip하고 cron이 **500**을 반환한다 |
| `NOTIFY_FROM` | Vercel 환경변수 | 기본값 `onboarding@resend.dev`는 Resend 계정 소유자 주소로만 배달된다 |

Resend에서 도메인을 검증하지 않으면 계정 소유자 본인 주소 외에는 발송이 거부된다
(403 `validation_error`). 다른 주소로 받으려면 resend.com/domains에서 도메인을 검증하고
`NOTIFY_FROM`을 그 도메인 주소로 지정해야 한다.

### 4. Vercel 프로젝트 설정 — Root Directory

**Settings → General → Root Directory 를 `apps/web` 으로 지정한다.**

저장소 루트에 두면 `No Next.js version detected` 로 빌드가 실패한다. `next`는
`apps/web/package.json`에만 있고 루트에는 `turbo`·`typescript`·`vitest`뿐이다.

- 바로 아래 **"Include source files outside of the Root Directory"** 토글이 켜져 있어야
  한다. `packages/*`가 `apps/web` 밖에 있다.
- Build/Install Command는 기본값을 쓴다. Vercel이 워크스페이스 루트에서 설치해야
  `workspace:*` 의존성 6개가 풀린다.
- `vercel.json`은 Root Directory 기준으로 찾으므로 `apps/web/vercel.json`이 맞는 위치다.
- **Build Command에 `--turbopack`을 붙이지 말 것.** `next.config.ts`의
  `webpack.resolve.extensionAlias`가 ESM `.js`→`.ts` 해석을 푸는데 Turbopack은 이 콜백을
  무시한다. 워크스페이스 패키지 import가 전부 깨진다.

### 5. Vercel 환경변수

`CRON_SECRET`, `SCORING_TOKEN`, `SUPABASE_*`, `RESEND_API_KEY`, `NOTIFY_FROM`.
`lib/guard.ts`는 토큰이 없으면 **500으로 닫는다**(열어두지 않는다). 누락되면 모든 라우트가 죽는다.

크론은 UTC로 돈다. `vercel.json`의 `0 16 * * *`(collect) / `0 0 * * *`(notify)는
각각 KST 01:00 / 09:00이다.

### 6. 첫 notify 실행은 눈으로 확인

`0002` 적용 후 첫 실행의 응답과 Vercel 로그를 한 번은 직접 본다.

## 실패를 어떻게 알아채는가

**cron 라우트의 HTTP 상태 코드가 여전히 유일한 능동 신호다.** 대시보드는 사람이 열어봐야
보이고, 알림을 보내지 않는다.

- `200` — 정상. 발송했거나, 후보가 없어 쉬었다(`skipped: 'no candidates above threshold'`).
- `500` — 사람이 봐야 한다. 건별 실패가 있거나, `notify_email`이 비어 있다.

Vercel cron 로그에서 500을 확인하고, 응답 본문의 `failed` 배열을 읽으면 된다
(장애 중에도 부분 결과를 볼 수 있도록 본문은 500일 때도 그대로 반환한다).

대시보드(`/`, `/jobs`)가 보태는 것은 **상태 스트립뿐이다** — 마지막 채점 시각(7일을 넘기면
"지연" 경고), 채점 진행률, 알림 대기 건수, 루브릭 버전 분포. 채점은 수동이라 cron 상태
코드로는 "채점이 멈췄다"를 절대 알 수 없고, 그 구멍을 메우는 것이 스트립의 지연 경고다.
반대로 수집·발송 실패는 스트립에 안 뜨므로 cron 로그를 계속 봐야 한다.

## 알면서 남겨둔 것

전부 최종 리뷰에서 판정한 뒤 의도적으로 남긴 것들이다.

| 항목 | 현상 | 왜 안 고쳤나 |
| --- | --- | --- |
| Resend idempotency 24시간 만료 | 아주 드물게 다이제스트 1통 중복 | 2단계 커밋은 개인용 도구에 과하다 |
| `runs.started_at`/`ended_at` 시계 불일치 | `runs` 기준 소요시간이 음수로 보일 수 있음 | 관측용 컬럼이고 소비처가 없다. `node_runs.duration_ms`는 영향 없음 |
| Wanted 422 시 search 자동 비활성화 없음 | 태그 체계가 바뀌면 수집이 멈춤 | 다시 켤 화면이 없어(대시보드는 읽기 전용이다) 자동 비활성화가 더 위험하다. cron 500으로 관측 가능 |
| `in()` 쿼리스트링 길이, `MAX_PAGES` 무음 절단 | 5000건 규모에서 발동 | 실측 168건. 검색 조건을 크게 넓히면 그때 고친다 |
| `profile.rubric_version` 미사용 | DB 컬럼이 미끼(운영 값은 여전히 `v1`) | 대시보드가 생겼어도 이 컬럼을 안 쓴다 — 스트립은 `scores.rubric_version`(채점 시점에 박힌 값)을 세고, `/api/scoring/pending`은 코드 상수를 돌려준다. 컬럼을 지우려면 마이그레이션이 필요한데 얻는 게 없다 |

## 개발 시 주의

- 테스트는 **루트에서** `pnpm test`. 워크스페이스에는 `test` 스크립트가 없어
  `pnpm -r test`는 아무것도 돌리지 않고 조용히 성공한다.
- `packages/db/test/supabase-store.test.ts`는 대상 프로젝트의 **모든 테이블을 비운다.**
  Supabase 프로젝트가 하나뿐이라 운영 데이터가 날아갈 수 있어 `SUPABASE_TEST_ALLOW_TRUNCATE=1`
  옵트인을 요구한다. 지워도 되는 별도 프로젝트에서만 쓸 것.
- 백필은 `pnpm backfill` (로컬 전용, cron 없이 전량 수집).

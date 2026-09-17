-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `create or replace`라 재실행해도 안전하다.
--
-- 중복으로 표시된 공고(duplicate_of not null)를 "미채점" 목록에서 뺀다.
--
-- 왜 필요한가: 0011이 jobs_needing_score(채점 큐)에만 duplicate_of 조건을 넣고 이
-- 뷰는 그대로 뒀다. 그 결과 중복 행은 채점 큐에서 빠져 영원히 채점되지 않는데,
-- 채점이 안 되니 이 뷰의 조건(status='ok'인 scores 행이 없음)에는 영원히 걸린다 —
-- 화면의 "미채점"에 영구 거주하게 된다. 실측: 미채점 21건이 전부 중복 행이었고
-- 진짜 미채점은 0건이었다.
--
-- hidden = false 조건만으로는 걸러지지 않는다. 중복은 일부러 hidden을 쓰지 않고
-- 별도 컬럼으로 표시하기 때문이다(0011의 근거 주석 참고) — hidden은 이미 쓰는
-- 주체가 셋이라 네 번째가 끼면 "왜 안 보이는가"를 되짚을 수 없다.
--
-- security_invoker를 빠뜨리면 뷰가 소유자 권한(BYPASSRLS)으로 돌아 anon이 이 뷰로
-- jobs를 전부 읽게 된다. 0001의 주석이 경고한 그 구멍이다 — 아래 옵션을 지우지 마라.
--
-- 부수 효과: `select j.*`가 다시 전개되면서 0005 이후 jobs에 추가된 컬럼
-- (annual_from, annual_to, rechecked_at, duplicate_of)이 뷰에 들어온다. 뷰의 `*`는
-- 생성 시점에 굳으므로, 테이블에 컬럼을 더할 때 그 테이블을 `*`로 읽는 뷰도 함께
-- 다시 만들어야 한다.
create or replace view jobs_unscored
  with (security_invoker = true) as
  select j.* from jobs j
  left join scores s on s.job_id = j.id
  where j.hidden = false
    and j.duplicate_of is null
    and (s.job_id is null or s.status <> 'ok');

-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `create or replace view`라 재실행해도 안전하다.
--
-- 왜 뷰인가: listUnscoredJobs는 처음에 PostgREST의 `scores!left(status)` embed +
-- `.or(...)` 필터로 짰었다. 그런데 그 필터는 자식(scores)만 걸러내고 부모(jobs)는
-- 제외하지 않는다 — 운영 DB(전량 채점 완료 상태)에 직접 읽기 전용으로 확인해보니
-- 조건에 안 맞는 스코어가 있어도 job 행 자체는 scores: null을 단 채 그대로
-- 돌아왔다. 그래서 "넉넉히 받아 JS에서 필터 후 자르기"로 우회했었는데, 그 방식은
-- first_seen_at 오름차순 정렬에 서버 limit을 걸어야 해서 결국 "가장 오래된 N건"만
-- 보고 그 안에서 골라내는 꼴이 된다 — jobs가 그 상한을 넘어가면 정작 이 기능이
-- 보여줘야 할 대상(방금 수집돼 아직 채점 안 된, 즉 가장 *최신* 축에 속하는 행)이
-- 상한 밖으로 밀려 조용히 빠진다. jobs_needing_score(0001_init.sql)가 이미 같은
-- 문제를 SQL 조건절로 풀어놓았으므로 그대로 따라, JS 필터링 없이 뷰의 결과를
-- limit()으로 바로 자른다.
--
-- jobs_needing_score와 조건이 다른 이유:
--   - attempts >= 3(영구 실패)를 제외하지 않는다. jobs_needing_score는 채점 큐를
--     먹이는 뷰라 재시도 상한에 닿은 건 더 이상 큐에 없어야 맞다. 반면 이 뷰는
--     "왜 목록에 안 올라오는지" 소유자에게 보여주는 화면이라, 영구 실패한 job이야말로
--     숨기면 안 된다 — 안 그러면 채점을 포기한 공고가 어디에도 안 보이고 조용히
--     사라진다.
--   - hidden = true인 job은 제외한다. listDashboardJobs 등 다른 조회들과 같은 원칙.
--   - "미채점"의 정의는 status='ok'인 scores 행이 없음이다. status='failed'인 행도
--     미채점으로 친다(MemoryStore.listUnscoredJobs와 동일 — 두 구현이 같은 답을
--     내야 한다).
create or replace view jobs_unscored
  with (security_invoker = true) as
  select j.* from jobs j
  left join scores s on s.job_id = j.id
  where j.hidden = false
    and (s.job_id is null or s.status <> 'ok');

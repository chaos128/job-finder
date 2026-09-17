-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `if not exists`라 재실행해도 안전하다.
--
-- 마감 재확인이 한 바퀴 도는 순서를 정하는 컬럼이다. 수집 cron이 한 실행에 N건만
-- 다시 조회하므로, 오래 확인 안 된 것부터 고르려면 마지막 확인 시각이 필요하다.
-- null이면 아직 한 번도 확인하지 않은 것이라 가장 먼저 집는다.
--
-- 왜 due_time으로 대신할 수 없나: 운영 240건 중 198건이 상시채용(due_time 없음)이라
-- 날짜 기준으로 고르면 그 198건은 영원히 재확인 대상이 되지 않는다. 마감일이 있는
-- 42건만 봐도 날짜는 못 믿는다 — 실측에서 저장 마감이 지난 7건을 다시 조회하니
-- 2건은 여전히 active였다(한 건은 마감이 09-10에서 09-27로 연장, 한 건은 상시채용
-- 전환). 반대로 마감일이 미래인데 status가 close인 건도 있었다.
alter table jobs add column if not exists rechecked_at timestamptz;

-- 재확인 대상("hidden 아니고 상세를 받은 것 중 오래된 순")을 고르는 질의가 쓴다.
create index if not exists jobs_recheck_idx
  on jobs (rechecked_at)
  where hidden = false and detail_status = 'ok';

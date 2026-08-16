-- 이 파일은 Supabase 대시보드 SQL 에디터에서 사람이 직접 실행한다
-- (레포에 마이그레이션 러너가 없다). `if not exists`라 재실행해도 안전하다.
--
-- 왜 필요한가: runs에는 trigger(cron/manual/cli)만 있어 collect인지 notify인지
-- 구분할 수 없다. node_runs로 역추적할 수 있지만, 아무 항목도 처리하지 않은
-- 실행(후보가 없어 skip한 notify, 신규 0건인 collect)은 node_runs가 비어 있어
-- 판별이 불가능하다. 대시보드가 "마지막 collect가 언제 돌았나"에 답하려면 필요하다.
--
-- not null을 걸지 않는다 — 기존 행에는 값이 없고 소급해 채울 근거가 없다.
alter table runs add column if not exists pipeline text;

-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `if not exists`로 멱등하다.
--
-- 왜 jobs가 아니라 scores인가: 목록은 채점된 공고만 보여주므로 요약이 채점과 함께
-- 도착하면 빈 값이 생기지 않는다. jobs에 두면 신규 수집분이 별도 생성 패스를
-- 돌리기 전까지 비고, 수동 단계가 하나 더 는다.
--
-- nullable인 이유: 이 컬럼이 생기기 전에 채점된 행이 이미 있다. 그 행들은
-- 백필로 채운다. 신규 제출은 스키마가 필수로 강제한다.
alter table scores add column if not exists summary text;

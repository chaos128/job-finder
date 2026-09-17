-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `if not exists`라 재실행해도 안전하다.
--
-- 같은 공고가 Wanted와 Remember 양쪽에 올라오면 jobs에 두 행이 생기고, 둘 다
-- 채점되어 하루 top 3 메일 슬롯을 둘 차지한다. 나중에 들어온 쪽에 원본을 가리키는
-- 포인터를 달아 기본 목록·채점·발송에서 빼되, 행은 지우지 않는다.
--
-- 왜 hidden을 재사용하지 않나: hidden은 이미 쓰는 주체가 셋이다(사람의 제외,
-- 0008의 저점수 자동 제외, recordJobRecheck의 마감 자동 제외). 네 번째로 중복까지
-- 끼워 넣으면 "왜 안 보이는가"를 되짚을 수 없고 되돌리기의 뜻도 모호해진다.
--
-- 왜 수집 시 버리지 않나: 대기업은 같은 회사·같은 제목으로 다른 팀 공고를 동시에
-- 올린다. 휴리스틱이 이걸 중복으로 보면 DB에 흔적조차 없어 놓친 줄도 모른다.
-- Blind 커버리지를 표본 73%에서 실측 56%로 바로잡을 수 있었던 것도 확정 못 한
-- 회사를 행으로 남겼기 때문이다.
alter table jobs
  add column if not exists duplicate_of uuid references jobs(id) on delete set null;

-- listDedupIndex("중복 아니고 제외 안 된 것 중 오래된 순")를 받는다.
-- jobs_recheck_idx와 같은 모양의 부분 인덱스다.
create index if not exists jobs_dedup_idx
  on jobs (first_seen_at)
  where duplicate_of is null and hidden = false;

-- 중복은 채점하지 않는다. 뷰를 다시 만들어야 하는데, security_invoker를 빠뜨리면
-- 뷰가 소유자 권한(BYPASSRLS)으로 돌아 anon이 이 뷰로 jobs를 전부 읽게 된다.
-- 0001의 주석이 경고한 그 구멍이다 — 아래 옵션을 지우지 마라.
--
-- drop과 create를 트랜잭션으로 묶는다. 둘 사이에 뷰가 없는 순간이 생기면 그때
-- /api/scoring/pending이 깨진다 — 채점 routine이 대기 목록을 받는 유일한 경로다.
-- Supabase SQL Editor가 이 파일을 "destructive operations" 경고로 띄우는데,
-- drop 대상이 데이터가 아니라 뷰(저장된 질의)이고 cascade도 없어서 의존 객체가
-- 있었다면 연쇄 삭제가 아니라 에러로 멈춘다. 경고는 키워드 매칭이다.
begin;

drop view if exists jobs_needing_score;
create view jobs_needing_score
  with (security_invoker = true) as
  select j.* from jobs j
  left join scores s on s.job_id = j.id
  where j.detail_status = 'ok'
    and j.duplicate_of is null
    and (s.job_id is null or (s.status = 'failed' and s.attempts < 3));

commit;

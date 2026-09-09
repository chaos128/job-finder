-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `if not exists`라 재실행해도 안전하다.
--
-- Blind(teamblind.com) 회사 별점을 담는다. jobs에 컬럼으로 붙이지 않고 별도 표로 둔 이유:
-- 같은 회사가 공고 여러 건으로 들어오는데(운영 224건 / 고유 회사 187곳), jobs에
-- 비정규화하면 같은 값을 회사당 N번 저장해야 하고 무엇보다 **이미 아는 회사의 새 공고가
-- 다음 갱신 전까지 빈칸으로 보인다**. 회사명을 키로 두면 새 공고가 들어오는 순간 조인만으로
-- 별점이 붙는다.
--
-- 키가 company_name(원문)인 이유: jobs가 가진 유일한 회사 식별자가 이 문자열이다.
-- Blind 검색용 표기 변환("힐링페이퍼(강남언니)" → "힐링페이퍼")은 수집 쪽 관심사이고,
-- 조인 키는 Wanted가 준 원문 그대로여야 한다.
create table if not exists company_ratings (
  company_name text primary key,
  -- 'ok'이면 rating이 채워져 있고, 'not_found'면 Blind에 그 회사가 없다는 뜻이다.
  -- 미등록도 하나의 확정된 답이라 행으로 남긴다 — 안 그러면 매 실행이 없는 회사를
  -- 영원히 다시 조회한다(실측 커버리지 56%, 즉 열 곳 중 넷이 여기 해당한다).
  status       text not null default 'ok' check (status in ('ok', 'not_found')),
  rating       numeric(2,1),
  -- Blind가 매칭한 회사명. 원문과 다를 수 있어(에스케이일렉링크 → SK일렉링크) 그대로
  -- 남긴다. 오매칭이 생기면 화면에서 눈으로 잡을 수 있는 유일한 단서다.
  blind_name   text,
  blind_url    text,
  attempts     int  not null default 0,
  error        text,
  fetched_at   timestamptz not null default now()
);

-- 갱신 대상("아직 조회 안 했거나 오래된 회사")을 고르는 질의가 이 컬럼으로 정렬한다.
create index if not exists company_ratings_fetched_at_idx on company_ratings (fetched_at);

-- 다른 표와 같은 원칙: service_role만 통과, 정책은 두지 않는다.
alter table company_ratings enable row level security;

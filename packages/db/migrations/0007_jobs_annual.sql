-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `if not exists`와 조건부 update라
-- 재실행해도 안전하다.
--
-- Wanted 공고의 경력 요건("경력 5년 이상")을 담는다. HTML을 긁지 않는 이유: 상세는
-- 이미 JSON API(/api/v4/jobs/{id})로 받고 있고 그 응답에 annual_from·annual_to가
-- 정수로 들어 있다. 화면의 span은 CSS-in-JS 해시 클래스(wds-1pe0q6z)를 달고 있어
-- 빌드마다 바뀐다 — 셀렉터로 삼으면 조용히 깨진다.
--
-- 문자열이 아니라 정수 두 칸인 이유: **API가 주는 것이 이 둘뿐이다.** 화면의
-- "경력 5년 이상"은 저장된 값이 아니라 Wanted 프론트엔드가 두 정수로 만들어 그리는
-- 문구다(운영 40건의 raw를 뒤져 확인 — "경력"이 들어간 문자열은 전부 JD 본문이었다).
-- 그래서 문구를 저장하려 해도 누군가 먼저 만들어야 하고, 그 변환은 어차피 존재한다.
-- 렌더 시점에 두면 표기를 고칠 때 배포 한 번으로 끝나지만, 저장해 두면 240행을
-- 다시 만들어야 한다. to=100을 상한 없음으로 못 읽고 "경력 5-100년"으로 한 번
-- 저장해버리는 것이 정확히 그 경우다.
--
--   from  to   실제 표기            (운영 240건을 실제 페이지와 대조해 확인)
--   3     8    경력 3-8년
--   5     100  경력 5년 이상        to=100은 "상한 없음"을 뜻하는 센티널이다
--   8     8    경력 8년
--   0     10   신입-경력 10년
--   0     100  신입 이상
alter table jobs add column if not exists annual_from int;
alter table jobs add column if not exists annual_to   int;

-- 이미 수집한 공고는 다시 크롤링할 필요가 없다. 상세 응답 원본을 raw에 통째로
-- 저장해 둔 덕분에 여기서 바로 채운다(운영 240건 전부 두 필드를 갖고 있다).
update jobs
   set annual_from = (raw -> 'job' ->> 'annual_from')::int,
       annual_to   = (raw -> 'job' ->> 'annual_to')::int
 where annual_from is null
   and raw -> 'job' ->> 'annual_from' is not null;

-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `if not exists`라 재실행해도 안전하다.
--
-- 검색이 어느 사이트의 것인지 적는 컬럼이다. 지금까지는 소스가 하나뿐이라
-- params의 모양만 보고도 알 수 있었지만, Remember가 붙으면 params가 소스마다
-- 다른 모양이 되므로 무엇으로 파싱할지를 행이 직접 말해야 한다.
--
-- default 'wanted'라 이미 있는 행은 적용 전후 동작이 같다. 코드가 이 컬럼을
-- 읽기 시작하므로 **코드 배포보다 먼저 적용해야 한다.**
alter table searches add column if not exists source text not null default 'wanted';

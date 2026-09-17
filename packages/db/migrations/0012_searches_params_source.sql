-- 사람이 Supabase 대시보드 SQL Editor에서 실행한다. `where not (params ? 'source')`라
-- 재실행해도 안전하다(멱등) — 이미 채워진 행은 다시 건드리지 않는다.
--
-- 0010이 추가한 searches.source 컬럼은 default 'wanted'라 컬럼 자체는 기존 행에도
-- 채워진다. 하지만 discover.ts의 SOURCE_MISMATCH 가드는 그 컬럼이 아니라 params
-- 안에 든 source 판별자(search.params.source)를 본다 — 컬럼과 판별자는 서로 다른
-- 값을 가질 수 있는 별개 필드이기 때문이다. 이 브랜치 이전에 저장된 Wanted 검색
-- 행의 params는 pre-branch parseWantedSearchUrl이 만든 것이라 source 키가 아예
-- 없다(git show 11d211e:packages/sources/src/wanted/parse-url.ts로 확인). 그 결과
-- 0010만 적용하고 배포하면: search.source === 'wanted'인데 search.params.source는
-- undefined라 매 실행 SOURCE_MISMATCH(retryable: false)로 실패하고, 신규 Wanted
-- 공고 발견이 영구히 멈춘다.
--
-- 이 마이그레이션이 그 간극을 메운다: params에 source 키가 없는 행에 한해
-- 컬럼값을 그대로 params 안에 복사해 넣는다.
update searches
   set params = params || jsonb_build_object('source', source)
 where not (params ? 'source');

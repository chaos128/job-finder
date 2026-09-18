/**
 * 목록 검색어 처리. 두 스토어가 같은 입력을 같은 뜻으로 읽어야 해서 여기 한 곳에 둔다.
 */

/**
 * 사용자가 친 문자열 → 실제로 걸 검색어. null이면 필터를 걸지 않는다.
 *
 * **정책: `%`와 `*`는 버리고 `_`는 남긴다.** 셋 다 SQL LIKE 와일드카드로 새어 들어가고
 * 이스케이프가 통하지 않는데(운영 DB 실측 — 전체 370건 기준), 셋의 처지가 같지 않다.
 *
 *   position.ilike.*%*   → 370건 (전건)   `\%`를 붙여도 그대로 와일드카드다
 *   position.ilike.*_*   → 370건 (전건)   `_`는 "아무 글자 하나"라 사실상 전건
 *   position.ilike.***   → 370건 (전건)   `*`는 PostgREST가 `%`로 바꾼다
 *
 * `%`와 `*`는 회사명·포지션 370건 어디에도 **한 번도 나오지 않는다**. 글자 그대로
 * 찾는 길이 막혀 있고 찾을 대상도 없으니, 남겨 두면 과다 매치만 만든다 — 버린다.
 *
 * `_`는 다르다. 실재하는 포지션 둘에 들어 있다:
 *
 *   ICT융합연구소_UI/UX Front, Backend 개발자
 *   풀스택_FDE(Forward Deployed Engineer)
 *
 * 그리고 `_`를 와일드카드로 흘려보내도 **글자 그대로의 `_`를 포함한다**("아무 글자
 * 하나"에 `_` 자신도 해당한다). 실측으로 갈린다:
 *
 *   position.ilike.*풀스택_FDE*   → 1건   남기면 찾는다
 *   position.ilike.*풀스택FDE*    → 0건   빼면 못 찾는다
 *
 * 즉 `_`를 버리면 사용자가 목록에서 제목을 복사해 붙여 넣는 순간 0건이 된다.
 * 남기면 이론상 과다 매치(`풀스택XFDE`도 걸린다)지만, 실제로 잃는 것은 없고 얻는
 * 것은 "붙여 넣으면 찾아진다"이다. 과다 매치 쪽을 택한다.
 *
 * 남은 것이 없으면(`%` 한 글자 같은 경우) null이라 필터가 아예 걸리지 않는다 —
 * 전건이 나온다. "와일드카드만 친 검색어"와 "빈 검색어"를 같게 다루는 셈이다.
 *
 * **최소 길이 제한은 두지 않는다.** 한 글자면 거의 전건이 걸리지만, 입력은 디바운스
 * 되고 화면에 건수가 함께 뜬다 — 약하게 걸리는 필터는 사용자가 보고 더 치면 되는데,
 * 조용히 무시하는 필터는 입력창이 고장 난 것처럼 보인다.
 */
export function normalizeSearchTerm(raw: string | undefined): string | null {
  // 버린 뒤에 다시 trim한다 — `"% "`는 제거 후 공백만 남는다.
  const stripped = (raw ?? '').replace(/[%*]/g, '').trim()
  return stripped === '' ? null : stripped
}

/**
 * 검색어 → PostgREST 필터 값. 반드시 큰따옴표로 감싼다 — 감싸지 않으면 사용자가
 * 회사명에 흔한 문자를 칠 때 조용히 틀리거나 페이지가 죽는다(운영 DB 실측):
 *
 *   "이베이재팬(eBay)"  감싸지 않으면 200인데 **0건** — 괄호가 로직 트리로 읽힌다
 *   "a,b"               감싸지 않으면 **400** — 쉼표가 or 절 구분자라 필터가 깨진다
 *
 * 큰따옴표 안에서는 `\`가 이스케이프 문자라, 값에 든 `\`와 `"`를 먼저 막아야 한다
 * (이 둘은 `%`·`_`와 달리 이스케이프가 통하는 것을 확인했다).
 *
 * `*`는 PostgREST가 `%`로 바꾼다 — 앞뒤에 붙여 부분 일치로 만든다.
 */
export function toIlikePattern(term: string): string {
  const escaped = term.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"*${escaped}*"`
}

/**
 * MemoryStore용. SupabaseStore의 `ilike` 부분 일치와 **같은 뜻**이어야 한다.
 *
 * 그래서 단순 부분 문자열 비교가 아니다 — normalizeSearchTerm이 `_`를 남기기로 한
 * 이상, 이쪽도 `_`를 "아무 글자 하나"로 읽어야 두 구현이 갈리지 않는다. 남겨 두면
 * `풀스택XFDE`를 담은 행이 SupabaseStore에서는 `풀스택_FDE`로 걸리고 여기서는
 * 안 걸린다 — 계약 테스트가 잡지 못하는 종류의 어긋남이 된다.
 *
 * `%`·`*`는 normalizeSearchTerm이 이미 버렸으므로 여기 올 수 없다.
 */
export function matchesSearchTerm(term: string, ...fields: string[]): boolean {
  // 정규식 메타문자를 먼저 막고(이 목록에 `_`는 없다), 그다음 `_`만 `.`로 푼다.
  const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')
  const re = new RegExp(pattern, 'i')
  return fields.some((f) => re.test(f))
}

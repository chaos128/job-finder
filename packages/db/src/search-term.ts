/**
 * 목록 검색어 처리. 두 스토어가 같은 입력을 같은 뜻으로 읽어야 해서 여기 한 곳에 둔다.
 */

/**
 * 사용자가 친 문자열 → 실제로 걸 검색어. null이면 필터를 걸지 않는다.
 *
 * TODO(human): 와일드카드 정책을 정해 주세요.
 *
 * PostgREST의 `ilike`는 값 안의 `*`를 SQL LIKE의 `%`로 바꿔 보냅니다. 그런데 사용자가
 * 직접 친 `%`와 `_`도 그대로 LIKE 와일드카드로 새어 들어가고, **이스케이프가 통하지
 * 않습니다**(운영 DB 실측 — 전체 296건 기준):
 *
 *   company_name.ilike."*%*"    → 296건 (전건)
 *   company_name.ilike."*\%*"   → 296건 (역슬래시를 붙여도 그대로 와일드카드)
 *   company_name.ilike."*_*"    → 296건 (`_`는 "아무 글자 하나"라 사실상 전건)
 *   company_name.ilike."*\_*"   → 296건
 *
 * 즉 "이스케이프해서 글자 그대로 찾기"는 이 경로로는 불가능합니다. 선택지는 대략:
 *
 *   (가) 제거한다        — `%`·`_`를 빼고 남은 걸로 검색. "50%" → "50"
 *   (나) 그대로 둔다     — 와일드카드로 쓰게 놔둔다. "카카오%페이"가 의미를 가진다
 *   (다) 필터를 끈다     — 와일드카드만 있는 검색어면 null을 반환해 전건을 보여준다
 *
 * 최소 길이 제한도 같이 정해 주세요 — 한 글자(예: "e")면 거의 전건이 걸리는데,
 * 그래도 사용자가 친 대로 보여줄지 무시할지는 취향입니다.
 *
 * 아래는 아직 아무 정책도 없는 상태입니다(공백만 정리). 그대로 두면 `%` 한 글자에
 * 전건이 나옵니다.
 */
export function normalizeSearchTerm(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  return trimmed === '' ? null : trimmed
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

/** MemoryStore용. SupabaseStore의 `ilike` 부분 일치와 같은 뜻이어야 한다. */
export function matchesSearchTerm(term: string, ...fields: string[]): boolean {
  const needle = term.toLowerCase()
  return fields.some((f) => f.toLowerCase().includes(needle))
}

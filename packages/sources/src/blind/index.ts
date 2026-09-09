/**
 * Blind(teamblind.com) 회사 별점 조회.
 *
 * 공개 API가 없어 검색 결과 HTML을 읽는다. 페이지에 __NEXT_DATA__ 같은 구조화
 * 페이로드가 없고(확인함), 인라인 JS 상태는 변수 참조로 압축돼 있어 파싱이 더
 * 취약하다. 반면 마크업의 `class="name"` 앵커 + 바로 뒤 `class="star"` 스팬은
 * 모양이 단순하고 안정적이라 이쪽을 쓴다.
 */

export class BlindHttpError extends Error {
  constructor(readonly status: number, readonly retryable: boolean) {
    super(`blind http ${status}`)
    this.name = 'BlindHttpError'
  }
}

export interface BlindCompany {
  name: string
  rating: number
  url: string
}

const BASE = 'https://www.teamblind.com'
// 봇 차단에 걸리지 않으려면 평범한 브라우저처럼 보여야 한다. 검색은 로그인 없이 열린다.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 검색 결과의 회사 카드. name 앵커 바로 뒤에 별점 스팬이 온다. */
const COMPANY_BLOCK = new RegExp(
  '<a href="(?<url>/kr/company/[^"]+)"\\s+class="name">\\s*(?<name>.*?)\\s*</a>'
  + '\\s*<span class="star">(?:<i class="blind">Rating Score</i>)?(?<star>[\\d.]*)</span>',
  's',
)

/**
 * Wanted 회사명을 Blind 검색어 후보로 편다. 실측(30곳)에서 이 순서가 커버리지를
 * 15%p 넘게 끌어올렸다 — 원문 그대로는 실패하지만 괄호를 떼면 잡히는 표기가 흔하다.
 *
 *   "힐링페이퍼(강남언니)" → 힐링페이퍼(적중) → 강남언니(이것도 적중한다)
 *   "이베이재팬(eBay)"    → 이베이재팬(적중)
 *
 * 괄호 안 별칭까지 시도하는 이유: Blind가 서비스명으로도 법인을 찾아준다
 * (캐치테이블 → 와드). 원문이 법인명일 때와 서비스명일 때 양쪽을 커버한다.
 */
export function searchCandidates(companyName: string): string[] {
  const raw = companyName.trim()
  const out = [raw]
  const paren = /^(.*?)\s*[（(]([^)）]+)[)）]\s*$/.exec(raw)
  if (paren) out.push(paren[1]!.trim(), paren[2]!.trim())

  const seen = new Set<string>()
  return out
    .map((c) => c.replace(/^(주식회사|㈜)\s*/, '').replace(/\s*(주식회사|㈜)$/, '').trim())
    .filter((c) => c.length > 0 && !seen.has(c) && (seen.add(c), true))
}

export function parseSearchPage(html: string): BlindCompany | null {
  const m = COMPANY_BLOCK.exec(html)
  if (!m?.groups) return null
  const { url, name, star } = m.groups
  const rating = Number(star)
  // 별점 스팬은 리뷰가 없는 회사에도 빈 값으로 붙는다. 0점짜리 별점은 없으므로
  // 파싱 실패와 "아직 평가 없음"을 굳이 구분하지 않고 둘 다 미등록으로 다룬다.
  if (!Number.isFinite(rating) || rating <= 0) return null
  return {
    name: (name ?? '').replace(/<[^>]+>/g, '').trim(),
    rating,
    url: BASE + url,
  }
}

async function fetchSearch(query: string): Promise<string> {
  const res = await fetch(`${BASE}/kr/search/${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
  })
  if (!res.ok) {
    // 429/5xx는 잠시 뒤 다시 하면 되고, 4xx는 다시 해도 같다.
    throw new BlindHttpError(res.status, res.status === 429 || res.status >= 500)
  }
  return res.text()
}

/**
 * 후보 표기를 순서대로 시도해 첫 번째로 잡히는 회사를 준다. 못 찾으면 null —
 * 호출자는 이걸 "Blind 미등록"이라는 확정된 답으로 기록한다(재조회를 막기 위해).
 */
export async function findCompanyRating(companyName: string): Promise<BlindCompany | null> {
  for (const q of searchCandidates(companyName)) {
    const hit = parseSearchPage(await fetchSearch(q))
    if (hit) return hit
  }
  return null
}

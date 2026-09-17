/**
 * 저장된 Blind 회사 URL → 리뷰 탭 URL.
 *
 * 회사 페이지(`/kr/company/유모스원/`)로 보내면 개요가 먼저 열려서 정작 보러 간
 * 리뷰를 한 번 더 눌러야 한다. 리뷰 탭(`/kr/company/유모스원/reviews`)이 목적지다.
 *
 * 저장된 값을 고치지 않고 그릴 때 바꾸는 이유: `company_ratings.blind_url`은 Blind가
 * 준 그대로여야 재조회 결과와 비교가 되고, 표기를 바꾸고 싶을 때 187행을 다시 만들
 * 일이 없다. 경력 요건을 정수 두 칸으로 저장하고 문구는 렌더할 때 만드는 것과 같은 규칙.
 *
 * 실제 저장 값은 끝에 슬래시가 붙어 있다(`.../company/%EC%99%80.../`). 그대로
 * 이어붙이면 `//reviews`가 되고, 반대로 Blind가 슬래시를 떼면 `...reviews`가 된다 —
 * 어느 쪽이든 맞도록 슬래시를 먼저 떼고 붙인다.
 */
export function blindReviewsUrl(blindUrl: string): string {
  return `${blindUrl.replace(/\/+$/, '')}/reviews`
}

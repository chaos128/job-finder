/**
 * 근무지 표기. 경력 요건과 같은 이유로 렌더 시점에 만든다 — 저장해 두면 표기를
 * 고칠 때마다 전 행을 다시 만들어야 한다(CLAUDE.md "경력 요건은 화면 문구가 아니라
 * 정수 두 칸이다" 참고).
 *
 * 두 소스가 같은 컬럼에 다른 정밀도를 넣는다(운영 370건 실측):
 *
 *   wanted    district='강남구'  full='서울 강남구 강남대로94길 86, 11층 (역삼동, 신영빌딩)'
 *   remember  district='강남구'  full='서울특별시 강남구'
 *   remember  district='전체'    full='서울특별시 전체'
 *
 * 그래서 카드는 district(구·시)만, 상세는 full만 그린다. 상세에서 둘 다 그리면
 * Remember 공고는 "강남구 / 서울특별시 강남구"처럼 같은 말이 두 번 나온다.
 */

/**
 * 카드에 그릴 구·시. 그릴 것이 없으면 null.
 *
 * `'전체'`를 거르는 이유: Remember는 지역을 특정하지 못한 공고에 이 값을 넣어
 * 보낸다(123건 중 10건). 값이 비어 있지 않으니 그냥 그리면 경력 옆에 "전체"라는
 * 칩이 붙어 **실재하는 지역명처럼 읽힌다** — 정보가 없다는 사실이 정보가 있다는
 * 표시로 뒤집힌다. `annual_to = 100`("상한 없음" 센티널)과 같은 부류다.
 *
 * `'서울특별시 전체'` 같은 addressFull은 반대로 그대로 둔다(상세). 거기엔 시·도가
 * 남아 있어 "서울 어딘가"라는 정보가 실제로 있다.
 */
export function districtLabel(district: string | null | undefined): string | null {
  const trimmed = district?.trim()
  if (!trimmed || trimmed === '전체') return null
  return trimmed
}

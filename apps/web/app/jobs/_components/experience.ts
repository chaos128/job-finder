/**
 * Wanted 공고의 경력 요건을 화면 문구로 바꾼다.
 *
 * 저장은 정수 두 칸(annual_from/annual_to)이고 표기는 여기서 만든다. 두 값의
 * 조합마다 Wanted가 다르게 적는데, 운영 240건에서 뽑은 대표 케이스를 실제 공고
 * 페이지와 대조해 확인한 규칙은 아래와 같다.
 *
 *   from  to    실제 표기          비고
 *   3     8     경력 3-8년
 *   12    20    경력 12-20년
 *   5     100   경력 5년 이상      to = 100은 "상한 없음" 센티널
 *   8     8     경력 8년           하한과 상한이 같으면 범위로 적지 않는다
 *   0     10    신입-경력 10년     from = 0은 신입 포함
 *   0     35    신입-경력 35년
 *   0     100   신입 이상          신입 포함 + 상한 없음
 *
 * 값이 없는 행(0007 적용 전 수집분, 상세 조회 전)은 null을 돌려주고 화면에서는
 * 아무것도 그리지 않는다 — 마감/상시채용과 같은 줄에 놓이므로 "정보 없음" 같은
 * 자리표시자를 넣으면 줄이 지저분해진다.
 */

/** 상한 없음을 뜻하는 Wanted의 센티널 값. */
export const NO_UPPER_BOUND = 100

export function formatExperience(
  annualFrom: number | null,
  annualTo: number | null,
): string | null {
  if (annualFrom === null || annualTo === null) return null

  const isNewcomer = annualFrom === 0
  if (annualTo === NO_UPPER_BOUND) {
    return isNewcomer ? '신입 이상' : `경력 ${annualFrom}년 이상`
  }
  if (isNewcomer) return `신입-경력 ${annualTo}년`
  // 하한과 상한이 같으면 "경력 8-8년"이 아니라 "경력 8년"으로 적는다.
  if (annualFrom === annualTo) return `경력 ${annualFrom}년`
  return `경력 ${annualFrom}-${annualTo}년`
}

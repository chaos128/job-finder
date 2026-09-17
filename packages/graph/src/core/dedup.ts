import type { DedupCandidate } from '@job-finder/db'

/**
 * 직무명이 이보다 짧으면 판정하지 않는다. 포함 관계(includes)로 보기 때문에
 * '개발자' 같은 짧은 제목은 같은 회사의 아무 공고나 빨아들인다.
 * 정규화를 마친 문자열의 문자 수 기준이다.
 */
const MIN_POSITION_LENGTH = 8

/**
 * 괄호 블록. '(주)'·'(유)' 같은 법인격과 '힐링페이퍼(강남언니)'의 브랜드 병기를
 * 한 규칙으로 걷어낸다. 사업부를 괄호로 구분하는 회사('삼성전자(DS부문)')는
 * 이 규칙 아래에서 한 회사로 뭉치는데, 감수한 선택이다 — 뭉친 쪽은 duplicate_of로
 * 남아 /jobs의 중복 토글에서 되돌릴 수 있지만, 놓친 중복은 아무 흔적도 남지 않는다.
 */
const BRACKET_BLOCK = /[([][^)\]]*[)\]]/g

/**
 * 괄호 밖에 적히는 법인격 표기. 영문은 단어 경계가 필요하다 — \bco\b 없이 지우면
 * 'Coupang'이 'upang'이 된다.
 */
const LEGAL_FORMS = /주식회사|유한회사|㈜|\b(?:inc|corporation|corp|ltd|co)\b\.?/gi

/**
 * 회사명을 비교용으로 정규화한다.
 *
 * 실측 — 같은 회사를 두 사이트가 이렇게 다르게 적는다:
 *   Remember '(주)루닛'                  ↔ Wanted '루닛'
 *   Remember '(주)인피니티익스체인지코리아' ↔ Wanted '인피니티익스체인지코리아'
 *   '주식회사 노써치'                     ↔ '노써치'
 *   '㈜토스'                             ↔ '토스'
 *
 * findDuplicate는 이 결과를 **완전 일치**로만 비교한다. 포함 관계로 열면
 * '토스' ⊂ '토스페이먼츠', '카카오' ⊂ '카카오뱅크'처럼 이름을 공유하는 별개
 * 법인이 뭉친다 — 한국 IT에서 흔한 형태라 미탐보다 이쪽이 비싸다.
 */
export function normalizeCompany(name: string): string {
  const stripped = name
    .replace(BRACKET_BLOCK, '')
    .replace(LEGAL_FORMS, '')
    .replace(/[\s.]/g, '')
    .toLowerCase()
  // 이름이 통째로 지워지는 경우(회사명이 '(주)' 뿐인 불량 데이터)에 빈 문자열을
  // 돌려주면 그런 회사끼리 전부 한 회사로 뭉친다. 지우기 전 이름으로 물러선다.
  return stripped || name.replace(/[\s.]/g, '').toLowerCase()
}

/**
 * 직무명을 비교용으로 정규화한다.
 *
 * 실측 데이터 — 같은 공고의 제목:
 *   Remember '[루닛]Senior Full Stack Engineer · AI Platform'
 *   Wanted   'Senior Full Stack Engineer'
 *
 * Remember는 제목에 '[회사명]' 접두와 '· 팀명' 접미를 붙이는 경우가 많다.
 * findDuplicate는 이 결과를 **포함 관계**로 비교하므로 완전 일치까지 갈 필요는 없다.
 */
export function normalizePosition(title: string): string {
  return title.replace(/\[[^\]]*\]/g, '').replace(/\s/g, '').toLowerCase()
}

/**
 * 같은 공고로 볼 기존 행을 찾는다. 없으면 null.
 *
 * index는 first_seen_at 오름차순이어야 한다 — 후보가 여럿일 때 먼저 수집된 쪽을
 * 원본으로 삼아야 실행 순서나 소스 순서로 결과가 흔들리지 않는다.
 * (listDedupIndex가 그 순서를 계약으로 보장한다.)
 */
export function findDuplicate(
  candidate: DedupCandidate,
  index: DedupCandidate[],
): DedupCandidate | null {
  const company = normalizeCompany(candidate.companyName)
  const position = normalizePosition(candidate.position)
  if (position.length < MIN_POSITION_LENGTH) return null

  for (const existing of index) {
    if (existing.id === candidate.id) continue
    // 이 기능은 설계상 교차 중복(다른 소스에서 같은 공고가 또 올라오는 경우)만
    // 잡는다. 같은 소스에서 재등록되면 소스가 새 external_id를 주고(listDedupIndex
    // 주석 참고) 재확인이 옛 행을 hidden 처리해 인덱스에서 빠지므로, 같은 소스끼리
    // 비교해 얻는 탐지 이득은 거의 없다. 반대로 같은 소스·같은 회사의 서로 다른
    // 공고(예: 'Frontend Engineer'와 'Frontend Engineer (MLOps, Vision AI Platform)')는
    // normalizePosition이 대괄호만 벗기고 괄호는 남기지 않아 포함 관계로 오판정될
    // 수 있다 — 되돌릴 방법이 없는 오탐이라(undo 경로 없음) 이 한 줄로 그 부류를
    // 통째로 제거하는 편이 낫다.
    if (existing.source === candidate.source) continue
    if (normalizeCompany(existing.companyName) !== company) continue
    const other = normalizePosition(existing.position)
    if (other.length < MIN_POSITION_LENGTH) continue
    if (position.includes(other) || other.includes(position)) return existing
  }
  return null
}

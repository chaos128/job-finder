import type { DedupCandidate } from '@job-finder/db'

/**
 * 직무명이 이보다 짧으면 판정하지 않는다. 포함 관계(includes)로 보기 때문에
 * '개발자' 같은 짧은 제목은 같은 회사의 아무 공고나 빨아들인다.
 * 정규화를 마친 **머리 부분**(괄호 앞)의 문자 수 기준이다.
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

/** 비교용 축약. 공백과 마침표를 지우고 소문자로 맞춘다. */
function squash(s: string): string {
  return s.replace(/[\s.]/g, '').toLowerCase()
}

/**
 * 회사명을 비교용으로 정규화한다.
 *
 * 실측 — 같은 회사를 두 사이트가 이렇게 다르게 적는다:
 *   Remember '(주)루닛'                  ↔ Wanted '루닛'
 *   Remember '(주)인피니티익스체인지코리아' ↔ Wanted '인피니티익스체인지코리아'
 *   '주식회사 노써치'                     ↔ '노써치'
 *   '㈜토스'                             ↔ '토스'
 *
 * 괄호 **밖**만 남긴 대표 이름이다. findDuplicate는 이것 하나로 비교하지 않고
 * companyKeys가 만드는 후보 집합을 쓴다 — 이유는 그쪽 주석 참고.
 */
export function normalizeCompany(name: string): string {
  const stripped = squash(name.replace(BRACKET_BLOCK, '').replace(LEGAL_FORMS, ''))
  // 이름이 통째로 지워지는 경우(회사명이 '(주)' 뿐인 불량 데이터)에 빈 문자열을
  // 돌려주면 그런 회사끼리 전부 한 회사로 뭉친다. 지우기 전 이름으로 물러선다.
  return stripped || squash(name)
}

/**
 * 같은 회사로 볼 이름 후보들. 괄호 **밖**(normalizeCompany)에 더해 괄호 **안**의
 * 각 토큰도 후보로 넣는다.
 *
 * 괄호 밖만 보면 두 사이트가 같은 회사를 이렇게 적을 때 놓친다(운영 실측):
 *   Wanted '에스케이일렉링크(SK일렉링크)' → '에스케이일렉링크'
 *   Remember 'SK일렉링크(주)'           → 'sk일렉링크'      ← 한글 음차 vs 영문
 *   Wanted '와드(캐치테이블)'            → '와드'
 *   Remember '캐치테이블'                → '캐치테이블'      ← 법인명 vs 서비스명
 * 두 경우 모두 **정답이 괄호 안에** 있다.
 *
 * 후보를 늘리면 당연히 오탐이 늘 수 있어 실측으로 확인했다 — 운영의 회사명 339개
 * 전부에 대해 "괄호 안 토큰이 다른 회사의 대표 이름과 겹치는가"를 세어 보니
 * 겹친 것은 위 두 쌍뿐이었고 **둘 다 실제로 같은 회사**였다. 오탐 0건이라 넣는다.
 *
 * 교집합이 하나라도 있으면 같은 회사로 본다. 여전히 **완전 일치**이고 포함 관계가
 * 아니다 — '토스' ⊂ '토스페이먼츠'처럼 이름을 공유하는 별개 법인이 뭉치는 쪽은
 * 열지 않는다.
 */
export function companyKeys(name: string): Set<string> {
  const keys = new Set([normalizeCompany(name)])
  for (const match of name.matchAll(/[([]([^)\]]*)[)\]]/g)) {
    const key = squash((match[1] ?? '').replace(LEGAL_FORMS, ''))
    // 한 글자 토큰은 후보로 쓰지 않는다. LEGAL_FORMS가 '㈜'는 지우지만 '(주)'의
    // '주'는 남는데, 그 한 글자가 키가 되면 '(주)'를 쓰는 회사 전부가 서로
    // 중복으로 뭉친다. 한 글자로 식별되는 회사명도 없다.
    if (key.length >= 2) keys.add(key)
  }
  return keys
}

/**
 * 직무명에서 **회사명 대괄호만** 벗긴다.
 *
 * 예전에는 대괄호를 전부 벗겼다. Remember가 '[루닛]Senior Full Stack Engineer'처럼
 * 회사명을 접두로 붙이기 때문인데, 운영 데이터를 세어 보니 그 가정이 틀렸다 —
 * 대괄호 121개 중 회사명은 **17개뿐**이고 나머지 104개는 서비스·조직·전형 표기다
 * ('[채널톡]', '[미리캔버스]', '[AX본부]', '[병역특례]', '[2년~7년]' …).
 *
 * 전부 벗기면 같은 회사의 **다른 제품** 공고가 뭉친다. 실제로 걸린 쌍:
 *   '[토스인슈어런스] Frontend Developer'  ↔ '[토스인컴] Frontend Developer (Senior)'
 * 둘은 다른 계열사의 다른 공고인데 대괄호를 지우면 'frontenddeveloper'로 같아진다.
 * duplicate_of는 되돌릴 경로가 없으므로(CLAUDE.md 참고) 미탐보다 오탐이 비싸다.
 *
 * 그래서 대괄호 안이 **회사명 후보와 일치할 때만** 벗기고, 나머지는 남겨서 비교에
 * 쓴다. 남긴 쪽은 두 사이트가 같은 표기를 쓰면 그대로 일치하므로 손해가 없다
 * ('[채널톡] Software Engineer'는 Wanted·Remember 양쪽에 같은 모양으로 들어온다).
 */
function stripCompanyBrackets(title: string, keys: ReadonlySet<string>): string {
  return title.replace(/\[([^\]]*)\]/g, (whole, inner: string) =>
    keys.has(squash(inner.replace(LEGAL_FORMS, ''))) ? '' : whole)
}

/** 소괄호 앞의 머리와, 괄호 안 내용들(원문 그대로 — 이니셜을 따야 한다). */
interface PositionParts { head: string; tails: string[] }

/**
 * 직무명을 머리와 괄호 꼬리로 가른다.
 *
 * 소괄호를 머리에 남겨 두면 같은 공고를 놓친다(운영 실측):
 *   Wanted   'Frontend Engineer (TMS)'
 *   Remember 'Frontend Engineer (Transportation Management System)'
 *   Wanted   'AI 프로덕트 엔지니어 (5년 이상)'
 *   Remember 'AI 프로덕트 엔지니어 (경력 5년 이상)'
 * 반대로 괄호를 그냥 버리면 같은 회사의 다른 공고가 뭉친다 — 유모스원은 Wanted에
 * '(TMS)'·'(FMS)'·'(WMS)' 세 건이 따로 있다. 그래서 버리지 않고 따로 들고 가
 * tailsAgree가 판정한다.
 */
function parsePosition(title: string, keys: ReadonlySet<string>): PositionParts {
  const tails: string[] = []
  const head = stripCompanyBrackets(title, keys)
    .replace(/\(([^)]*)\)/g, (_, inner: string) => { tails.push(inner); return '' })
  return { head: squash(head), tails }
}

/** 단어 첫 글자. 'Transportation Management System' → 'tms' */
function initials(s: string): string {
  return s.trim().split(/[\s/_-]+/).filter(Boolean)
    .map((w) => w[0]).join('').toLowerCase()
}

/**
 * 괄호 꼬리가 같은 공고를 가리키는지.
 *
 * - 한쪽에 괄호가 없으면 판정하지 않는다(true). 두 사이트 중 한쪽만 부제를 붙이는
 *   경우가 흔하고, 머리가 이미 일치한 상태라 여기서 더 조이면 미탐만 늘어난다.
 * - 둘 다 있으면 포함 관계이거나 한쪽이 다른 쪽의 이니셜이어야 한다.
 *   'TMS' ↔ 'Transportation Management System'은 통과하고,
 *   'FMS'·'WMS' ↔ 'Transportation Management System'은 걸러진다.
 */
function tailsAgree(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true
  return a.some((x) => b.some((y) => {
    const nx = squash(x)
    const ny = squash(y)
    if (!nx || !ny) return true
    if (nx.includes(ny) || ny.includes(nx)) return true
    return initials(x) === ny || initials(y) === nx
  }))
}

/**
 * 직무명을 비교용으로 정규화한다. 회사명 대괄호를 벗기고 공백을 지운다.
 * 괄호 꼬리까지 포함한 전체 문자열이라, 판정은 parsePosition을 쓰는
 * findDuplicate가 한다 — 이 함수는 표시·디버깅용이다.
 */
export function normalizePosition(title: string, keys: ReadonlySet<string> = new Set()): string {
  return squash(stripCompanyBrackets(title, keys))
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
  const keys = companyKeys(candidate.companyName)

  for (const existing of index) {
    if (existing.id === candidate.id) continue
    // 이 기능은 설계상 교차 중복(다른 소스에서 같은 공고가 또 올라오는 경우)만
    // 잡는다. 같은 소스에서 재등록되면 소스가 새 external_id를 주고(listDedupIndex
    // 주석 참고) 재확인이 옛 행을 hidden 처리하므로, 같은 소스끼리 비교해 얻는
    // 탐지 이득은 거의 없다. 반대로 같은 소스·같은 회사의 서로 다른 공고가
    // 오판정될 수 있다 — 되돌릴 방법이 없는 오탐이라(undo 경로 없음) 이 한 줄로
    // 그 부류를 통째로 제거하는 편이 낫다.
    if (existing.source === candidate.source) continue

    const otherKeys = companyKeys(existing.companyName)
    if (![...keys].some((k) => otherKeys.has(k))) continue

    // 대괄호 판정에는 두 회사명의 후보를 합쳐 쓴다 — 한쪽은 '루닛', 다른 쪽은
    // '(주)루닛'처럼 적히고 접두는 그중 하나로만 붙기 때문이다.
    const shared = new Set([...keys, ...otherKeys])
    const mine = parsePosition(candidate.position, shared)
    const theirs = parsePosition(existing.position, shared)
    if (mine.head.length < MIN_POSITION_LENGTH) continue
    if (theirs.head.length < MIN_POSITION_LENGTH) continue
    if (!(mine.head.includes(theirs.head) || theirs.head.includes(mine.head))) continue
    if (!tailsAgree(mine.tails, theirs.tails)) continue
    return existing
  }
  return null
}

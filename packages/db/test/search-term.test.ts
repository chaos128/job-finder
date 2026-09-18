import { describe, expect, it } from 'vitest'
import { matchesSearchTerm, normalizeSearchTerm, toIlikePattern } from '../src/search-term.js'

describe('normalizeSearchTerm', () => {
  it('평범한 검색어는 그대로 둔다', () => {
    expect(normalizeSearchTerm('카카오')).toBe('카카오')
    expect(normalizeSearchTerm('  프론트엔드  ')).toBe('프론트엔드')
  })

  it('빈 검색어는 필터 없음(null)이다', () => {
    expect(normalizeSearchTerm('')).toBeNull()
    expect(normalizeSearchTerm('   ')).toBeNull()
    expect(normalizeSearchTerm(undefined)).toBeNull()
  })

  // 글자 그대로 찾는 길이 막혀 있고(이스케이프 불가), 370건 어디에도 안 나온다.
  it('%와 *는 버린다', () => {
    expect(normalizeSearchTerm('50%')).toBe('50')
    expect(normalizeSearchTerm('카카오%페이')).toBe('카카오페이')
    expect(normalizeSearchTerm('front*end')).toBe('frontend')
  })

  // 와일드카드만 친 검색어는 빈 검색어와 같게 다룬다 — 필터가 걸리지 않아 전건이 나온다.
  // 남겨 두면 `%` 한 글자에 ilike가 전건을 주는데, 그건 "필터가 걸렸는데 전건"이라
  // 사용자가 필터를 신뢰할 수 없게 된다.
  it('와일드카드만 있으면 null이라 필터가 아예 안 걸린다', () => {
    expect(normalizeSearchTerm('%')).toBeNull()
    expect(normalizeSearchTerm('*')).toBeNull()
    expect(normalizeSearchTerm('%*%')).toBeNull()
    expect(normalizeSearchTerm(' % ')).toBeNull()
  })

  // 운영에 실재하는 포지션 둘에 들어 있다. 버리면 제목을 복사해 붙여 넣을 때 0건이 된다.
  it('_는 남긴다 — 실재하는 포지션에 들어 있다', () => {
    expect(normalizeSearchTerm('풀스택_FDE')).toBe('풀스택_FDE')
    expect(normalizeSearchTerm('ICT융합연구소_UI')).toBe('ICT융합연구소_UI')
  })

  it('한 글자도 막지 않는다 — 최소 길이 제한을 두지 않는다', () => {
    expect(normalizeSearchTerm('e')).toBe('e')
  })
})

describe('toIlikePattern', () => {
  it('부분 일치로 만들고 큰따옴표로 감싼다', () => {
    expect(toIlikePattern('카카오')).toBe('"*카카오*"')
  })

  // 감싸지 않으면 괄호는 조용히 0건, 쉼표는 400이다(운영 DB 실측).
  it('괄호·쉼표가 든 검색어도 값 안에 그대로 담는다', () => {
    expect(toIlikePattern('이베이재팬(eBay)')).toBe('"*이베이재팬(eBay)*"')
    expect(toIlikePattern('a,b')).toBe('"*a,b*"')
  })

  // 큰따옴표 안에서 `\`가 이스케이프 문자라, 값에 든 `\`와 `"`를 먼저 막아야 한다.
  it('역슬래시와 큰따옴표를 이스케이프한다', () => {
    expect(toIlikePattern('a"b')).toBe('"*a\\"b*"')
    expect(toIlikePattern('a\\b')).toBe('"*a\\\\b*"')
  })
})

describe('matchesSearchTerm', () => {
  it('두 필드 중 하나만 걸려도 참이고 대소문자를 무시한다', () => {
    expect(matchesSearchTerm('engineer', 'ACME', 'Frontend Engineer')).toBe(true)
    expect(matchesSearchTerm('ENGINEER', 'ACME', 'Frontend Engineer')).toBe(true)
    expect(matchesSearchTerm('designer', 'ACME', 'Frontend Engineer')).toBe(false)
  })

  // ilike와 같은 뜻이어야 한다: `_`는 "아무 글자 하나"이고, 글자 그대로의 `_`도 포함한다.
  it('_는 아무 글자 하나로 읽는다 — 글자 그대로의 _도 걸린다', () => {
    expect(matchesSearchTerm('풀스택_FDE', 'ACME', '풀스택_FDE(Forward Deployed Engineer)'))
      .toBe(true)
    expect(matchesSearchTerm('풀스택_FDE', 'ACME', '풀스택XFDE')).toBe(true)
    expect(matchesSearchTerm('풀스택_FDE', 'ACME', '풀스택FDE')).toBe(false)
  })

  // `_`를 `.`로 바꾸기 전에 정규식 메타문자를 막지 않으면 괄호가 그룹으로 읽혀 어긋난다.
  it('정규식 메타문자는 글자 그대로 찾는다', () => {
    expect(matchesSearchTerm('이베이재팬(eBay)', '이베이재팬(eBay)', 'x')).toBe(true)
    expect(matchesSearchTerm('a.b', 'aXb', 'x')).toBe(false)
    expect(matchesSearchTerm('a+b', 'a+b', 'x')).toBe(true)
  })
})

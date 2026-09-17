import { describe, expect, test } from 'vitest'
import { blindReviewsUrl } from '../app/jobs/_components/blind-url'

describe('blindReviewsUrl', () => {
  // 운영에 저장된 실제 모양(packages/sources/test/blind.test.ts의 픽스처와 같다).
  test('끝 슬래시가 있는 저장 값에 슬래시가 겹치지 않는다', () => {
    expect(blindReviewsUrl('https://www.teamblind.com/kr/company/%EC%9C%A0%EB%AA%A8%EC%8A%A4%EC%9B%90/'))
      .toBe('https://www.teamblind.com/kr/company/%EC%9C%A0%EB%AA%A8%EC%8A%A4%EC%9B%90/reviews')
  })

  // Blind가 슬래시를 떼도 `...유모스원reviews`가 되면 안 된다.
  test('끝 슬래시가 없어도 구분자가 들어간다', () => {
    expect(blindReviewsUrl('https://www.teamblind.com/kr/company/ACME'))
      .toBe('https://www.teamblind.com/kr/company/ACME/reviews')
  })
})

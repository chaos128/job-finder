import { expect, test } from 'vitest'
import { RUBRIC_AXES, RUBRIC_VERSION, loadRubric, scoreSubmissionSchema } from '../src/index.js'

const valid = {
  jobId: '11111111-1111-1111-1111-111111111111',
  total: 72,
  breakdown: { stack: 18, role: 16, domain: 14, growth: 12, conditions: 12 },
  reasoning: 'React/TS 주력이 requirements와 겹치고 연차도 맞는다.',
  summary: 'ACME에서 결제 웹 프론트엔드를 맡는 자리다.',
}

// 버전을 리터럴로 박으면 올릴 때마다 이 테스트만 고치고 넘어가게 된다.
// 진짜 잡아야 할 것은 상수와 본문 제목이 서로 어긋나는 경우다 — 채점자는 본문을
// 읽고 채점하는데 기록되는 버전은 상수라서, 어긋나면 어느 기준으로 매긴 점수인지 알 수 없다.
test('루브릭 본문의 버전과 RUBRIC_VERSION 상수가 일치한다', () => {
  expect(RUBRIC_VERSION).toMatch(/^v\d+$/)
  expect(loadRubric()).toContain(`# 채점 루브릭 ${RUBRIC_VERSION}`)
  expect(RUBRIC_AXES).toEqual(['stack', 'role', 'domain', 'growth', 'conditions'])
})

test('올바른 제출을 통과시킨다', () => {
  const parsed = scoreSubmissionSchema.parse([valid])
  expect(parsed[0]!.total).toBe(72)
})

test('total이 breakdown 합과 다르면 거부한다', () => {
  expect(() => scoreSubmissionSchema.parse([{ ...valid, total: 90 }]))
    .toThrow(/합계/)
})

test('축이 빠지면 거부한다', () => {
  const { stack: _drop, ...rest } = valid.breakdown
  expect(() => scoreSubmissionSchema.parse([{ ...valid, breakdown: rest, total: 54 }]))
    .toThrow()
})

test('모르는 축이 있으면 거부한다', () => {
  expect(() => scoreSubmissionSchema.parse([{
    ...valid,
    breakdown: { ...valid.breakdown, vibes: 5 },
    total: 77,
  }])).toThrow()
})

test('축 점수가 20을 넘으면 거부한다', () => {
  expect(() => scoreSubmissionSchema.parse([{
    ...valid,
    breakdown: { ...valid.breakdown, stack: 25 },
    total: 79,
  }])).toThrow()
})

test('축 점수가 정수가 아니면 거부한다', () => {
  expect(() => scoreSubmissionSchema.parse([{
    ...valid,
    breakdown: { ...valid.breakdown, stack: 17.5 },
    total: 71.5,
  }])).toThrow()
})

test('축 점수가 정수가 아니면 거부한다 — total과 합계가 우연히 맞아떨어져도 (axisScore 자체의 int 규칙 검증)', () => {
  // stack 18→18.5, role 16→15.5로 서로 상쇄시켜 breakdown 합계(72)와 total(72)이 그대로
  // 정수로 일치한다. total.int()나 sum refine으로는 안 걸리고, 오직 axisScore.int()만
  // 이 입력을 거부할 수 있다 — 위 테스트는 total 자체가 71.5라 total.int()에서 이미 걸린다.
  expect(() => scoreSubmissionSchema.parse([{
    ...valid,
    breakdown: { ...valid.breakdown, stack: 18.5, role: 15.5 },
  }])).toThrow()
})

test('reasoning이 비면 거부한다', () => {
  expect(() => scoreSubmissionSchema.parse([{ ...valid, reasoning: '' }])).toThrow()
})

test('summary가 없으면 거부한다', () => {
  const { summary: _drop, ...rest } = valid
  expect(() => scoreSubmissionSchema.parse([rest])).toThrow()
})

test('summary가 400자를 넘으면 거부한다', () => {
  expect(() => scoreSubmissionSchema.parse([{ ...valid, summary: '가'.repeat(401) }])).toThrow()
})

test('jobId가 uuid가 아니면 거부한다', () => {
  expect(() => scoreSubmissionSchema.parse([{ ...valid, jobId: 'nope' }])).toThrow()
})

test('빈 배열은 허용한다 (채점할 게 없었던 경우)', () => {
  expect(scoreSubmissionSchema.parse([])).toEqual([])
})

import { expect, test } from 'vitest'
import { RUBRIC_AXES, RUBRIC_VERSION, loadRubric, scoreSubmissionSchema } from '../src/index.js'

const valid = {
  jobId: '11111111-1111-1111-1111-111111111111',
  total: 72,
  breakdown: { stack: 18, role: 16, domain: 14, growth: 12, conditions: 12 },
  reasoning: 'React/TS 주력이 requirements와 겹치고 연차도 맞는다.',
}

test('루브릭 본문과 버전을 읽는다', () => {
  expect(RUBRIC_VERSION).toBe('v1')
  expect(loadRubric()).toContain('# 채점 루브릭 v1')
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

test('jobId가 uuid가 아니면 거부한다', () => {
  expect(() => scoreSubmissionSchema.parse([{ ...valid, jobId: 'nope' }])).toThrow()
})

test('빈 배열은 허용한다 (채점할 게 없었던 경우)', () => {
  expect(scoreSubmissionSchema.parse([])).toEqual([])
})

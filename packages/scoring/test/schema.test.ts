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

test('reasoning이 비면 거부한다', () => {
  expect(() => scoreSubmissionSchema.parse([{ ...valid, reasoning: '' }])).toThrow()
})

test('jobId가 uuid가 아니면 거부한다', () => {
  expect(() => scoreSubmissionSchema.parse([{ ...valid, jobId: 'nope' }])).toThrow()
})

test('빈 배열은 허용한다 (채점할 게 없었던 경우)', () => {
  expect(scoreSubmissionSchema.parse([])).toEqual([])
})

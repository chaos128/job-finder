import type { Job, Score, ScoredJob } from '@job-finder/db'
import { expect, test } from 'vitest'
import { renderDigest } from '../src/index.js'

function scored(position: string, company: string, total: number): ScoredJob {
  const job = {
    id: `job_${position}`, source: 'wanted', externalId: '1',
    position, companyName: company, companyId: 1,
    addressDistrict: '강남구', addressFull: '서울 강남구',
    url: 'https://www.wanted.co.kr/wd/1', dueTime: null,
    firstSeenAt: '2026-08-15T00:00:00.000Z',
    detailStatus: 'ok', detailAttempts: 0, detailError: null,
    bookmarked: false, hidden: false,
  } as Job
  const score = {
    jobId: job.id, total,
    breakdown: { stack: 18, role: 16, domain: 14, growth: 12, conditions: 12 },
    reasoning: '스택이 겹치고 연차가 맞는다.',
    scorer: 'routine', rubricVersion: 'v1', status: 'ok',
    attempts: 0, error: null, scoredAt: '2026-08-15T01:00:00.000Z', notifiedAt: null,
  } as Score
  return { job, score }
}

test('제목에 건수와 최고점을 담는다', () => {
  const { subject } = renderDigest([scored('Frontend Lead', 'ACME', 82), scored('FE', 'B', 71)])
  expect(subject).toContain('2건')
  expect(subject).toContain('82')
})

test('본문에 점수·회사·직무·링크가 들어간다', () => {
  const { html, text } = renderDigest([scored('Frontend Lead', 'ACME', 82)])
  for (const body of [html, text]) {
    expect(body).toContain('82')
    expect(body).toContain('ACME')
    expect(body).toContain('Frontend Lead')
    expect(body).toContain('https://www.wanted.co.kr/wd/1')
  }
})

test('근거와 축별 점수를 함께 보여준다', () => {
  const { text } = renderDigest([scored('Frontend Lead', 'ACME', 82)])
  expect(text).toContain('스택이 겹치고')
  expect(text).toContain('stack')
})

test('축은 jsonb 키 순서가 아니라 루브릭 순서로 보여준다', () => {
  const item = scored('Frontend Lead', 'ACME', 72)
  // Postgres jsonb가 정규화해 돌려주는 순서(길이 → 바이트)를 그대로 재현한다.
  item.score.breakdown = { role: 16, stack: 18, domain: 14, growth: 12, conditions: 12 }
  const { text } = renderDigest([item])
  expect(text).toContain('stack 18 · role 16 · domain 14 · growth 12 · conditions 12')
})

test('루브릭에 없는 축이 섞여 있어도 빠뜨리지 않고 뒤에 붙인다', () => {
  const item = scored('Frontend Lead', 'ACME', 72)
  item.score.breakdown = { vibes: 5, stack: 18 }
  expect(renderDigest([item]).text).toContain('stack 18 · vibes 5')
})

test('점수 내림차순으로 정렬한다', () => {
  const { text } = renderDigest([scored('Low', 'B', 61), scored('High', 'A', 88)])
  expect(text.indexOf('High')).toBeLessThan(text.indexOf('Low'))
})

test('HTML은 사용자 문자열을 이스케이프한다', () => {
  const item = scored('<script>alert(1)</script>', 'ACME', 70)
  const { html } = renderDigest([item])
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).toContain('&lt;script&gt;')
})

test('빈 목록이면 던진다 — 호출자가 먼저 걸러야 한다', () => {
  expect(() => renderDigest([])).toThrow(/비어/)
})

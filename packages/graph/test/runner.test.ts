import { MemoryStore } from '@job-finder/db'
import { expect, test } from 'vitest'
import { fail, ok, runNode, type Node } from '../src/index.js'

const doubler: Node<number, number> = {
  name: 'doubler',
  async run(input) { return ok(input * 2) },
}

async function setup() {
  const store = new MemoryStore()
  const runId = await store.startRun('cron')
  return { store, runId }
}

test('모든 항목을 처리하고 결과를 모은다', async () => {
  const { store, runId } = await setup()
  const summary = await runNode(doubler, [1, 2, 3], String, { runId, store })
  expect(summary.ok).toEqual([2, 4, 6])
  expect(summary.failed).toHaveLength(0)
})

test('한 항목이 실패해도 나머지는 계속 처리된다', async () => {
  const { store, runId } = await setup()
  const flaky: Node<number, number> = {
    name: 'flaky',
    async run(input) {
      return input === 2
        ? fail('BOOM', 'item 2 exploded', true)
        : ok(input * 10)
    },
  }
  const summary = await runNode(flaky, [1, 2, 3], String, { runId, store })
  expect(summary.ok).toEqual([10, 30])
  expect(summary.failed).toEqual([
    { itemId: '2', code: 'BOOM', message: 'item 2 exploded', retryable: true },
  ])
})

test('동시성 상한보다 항목이 많을 때, 실패 시점에 아직 착수되지 않은 항목도 격리되어 처리된다', async () => {
  const { store, runId } = await setup()
  const flaky: Node<number, number> = {
    name: 'flaky-sequential',
    async run(input) {
      return input === 2
        ? fail('BOOM', 'item 2 exploded', true)
        : ok(input * 10)
    },
  }
  const summary = await runNode(flaky, [1, 2, 3, 4, 5], String, { runId, store, concurrency: 1 })
  expect(summary.ok).toEqual([10, 30, 40, 50])
  expect(summary.failed).toEqual([
    { itemId: '2', code: 'BOOM', message: 'item 2 exploded', retryable: true },
  ])
})

test('노드가 던져도 runner가 삼키고 non-retryable로 기록한다', async () => {
  const { store, runId } = await setup()
  const thrower: Node<number, number> = {
    name: 'thrower',
    async run() { throw new Error('unexpected') },
  }
  const summary = await runNode(thrower, [1], String, { runId, store })
  expect(summary.ok).toHaveLength(0)
  expect(summary.failed[0]).toMatchObject({ code: 'UNCAUGHT', retryable: false })
  expect(store.nodeRuns[0]).toMatchObject({ runId, node: 'thrower', status: 'failed' })
  expect(store.nodeRuns[0]!.error).toContain('UNCAUGHT')
})

test('건별 결과를 node_runs에 기록한다', async () => {
  const { store, runId } = await setup()
  await runNode(doubler, [1, 2], String, { runId, store })
  expect(store.nodeRuns).toHaveLength(2)
  expect(store.nodeRuns[0]).toMatchObject({ runId, node: 'doubler', status: 'ok' })
  expect(store.nodeRuns[0]!.durationMs).toBeGreaterThanOrEqual(0)
})

test('동시 실행 수가 상한을 넘지 않는다', async () => {
  const { store, runId } = await setup()
  let inFlight = 0
  let peak = 0
  const slow: Node<number, number> = {
    name: 'slow',
    async run(input) {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return ok(input)
    },
  }
  await runNode(slow, [1, 2, 3, 4, 5, 6, 7, 8], String, { runId, store, concurrency: 3 })
  expect(peak).toBeLessThanOrEqual(3)
  // 상한 준수뿐 아니라 실제로 병렬 실행되고 있는지도 확인한다 — 이 하한이 없으면
  // 완전히 순차적인(peak === 1) runner도 이 테스트를 통과한다.
  expect(peak).toBe(3)
})

test('빈 목록은 아무것도 하지 않는다', async () => {
  const { store, runId } = await setup()
  const summary = await runNode(doubler, [], String, { runId, store })
  expect(summary.ok).toHaveLength(0)
  expect(store.nodeRuns).toHaveLength(0)
})

test('concurrency가 NaN이면 기본값으로 폴백하고, 모든 항목을 정상 처리한다', async () => {
  const { store, runId } = await setup()
  const summary = await runNode(doubler, [1, 2, 3], String, { runId, store, concurrency: NaN })
  expect(summary.ok).toHaveLength(3)
  expect(summary.failed).toHaveLength(0)
  expect(store.nodeRuns).toHaveLength(3)
})

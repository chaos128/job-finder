import { expect, test } from 'vitest'
import { MemoryStore } from '../src/index.js'
import { describeStoreContract } from './store-contract.js'

describeStoreContract('MemoryStore', async () => new MemoryStore())

// 계약 테스트로는 잡히지 않는 divergence다 — 이 가짜만 first_seen_at을 행마다
// 증가시키면, 실 스토어에 없는 "배치 안의 순서" 보장을 테스트가 증명해 버린다.
// 실 스토어는 `default now()`(트랜잭션 시각)라 한 배치가 전부 같은 값을 받는다.
test('한 배치로 넣은 job은 first_seen_at이 전부 같다', async () => {
  const store = new MemoryStore()
  const rows = await store.insertJobs(['1', '2', '3'].map((id) => ({
    source: 'wanted' as const, externalId: id, position: 'FE',
    companyName: 'ACME', companyId: 1, addressDistrict: null, addressFull: null,
    url: `https://www.wanted.co.kr/wd/${id}`, dueTime: null,
  })))
  expect(new Set(rows.map((r) => r.firstSeenAt)).size).toBe(1)
})

// 상한 자체는 계약 테스트에 넣지 않았다 — 201건을 실 DB에 넣는 비용이 크다.
// SupabaseStore 쪽은 같은 값을 질의의 .limit()으로 건다.
test('알림 후보는 상위 200건까지만 돌려준다', async () => {
  const store = new MemoryStore()
  const rows = await store.insertJobs(
    Array.from({ length: 201 }, (_, i) => ({
      source: 'wanted' as const, externalId: String(i), position: 'FE',
      companyName: 'ACME', companyId: 1, addressDistrict: null, addressFull: null,
      url: `https://www.wanted.co.kr/wd/${i}`, dueTime: null,
    })),
  )
  for (const [i, row] of rows.entries()) {
    await store.saveJobDetail(row.id, {
      intro: null, requirements: null, mainTasks: null,
      preferredPoints: null, benefits: null, skillTags: [], raw: {},
    })
    await store.saveScore({
      jobId: row.id, total: i, breakdown: {},
      reasoning: '', summary: '', scorer: 'routine', rubricVersion: 'v1',
    })
  }

  const candidates = await store.listNotifyCandidates()
  expect(candidates).toHaveLength(200)
  expect(candidates[0]!.score.total).toBe(200) // 잘리는 쪽은 항상 하위 점수다
})

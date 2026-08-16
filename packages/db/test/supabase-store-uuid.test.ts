import { afterEach, describe, expect, test, vi } from 'vitest'
import { createSupabaseStore } from '../src/index.js'

// 라이브 계약 스위트(supabase-store.test.ts)는 대상 프로젝트를 비우므로 켤 수 없다 —
// "uuid가 아닌 id에서 두 구현이 갈린다"는 divergence도 그래서 아무도 못 봤다.
// 이 스위트는 DB 없이 돈다: 가드가 빠지면 127.0.0.1:1로 실제 요청이 나가
// 연결 거부로 throw하므로, 통과 자체가 "질의 전에 걸렀다"는 증거가 된다.
const store = createSupabaseStore('http://127.0.0.1:1', 'test-key')

/** 커서 경로는 질의가 실제로 나가야 확인된다 — 나가는 URL만 가로챈다. */
function captureRequestUrls(body = '[]', headers: Record<string, string> = {}): string[] {
  const urls: string[] = []
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0]) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers },
    })
  })
  return urls
}

afterEach(() => { vi.unstubAllGlobals() })

describe('SupabaseStore는 uuid가 아닌 id에 MemoryStore와 같은 답을 준다', () => {
  test('getJobDetail은 질의하지 않고 null을 준다', async () => {
    await expect(store.getJobDetail('없는-id')).resolves.toBeNull()
  })

  test('setJobBookmarked는 질의하지 않고 조용히 넘어간다', async () => {
    await expect(store.setJobBookmarked('없는-id', true)).resolves.toBeUndefined()
  })

  test('커서의 jobId가 uuid가 아니면 동점 비교 항을 빼고 질의한다', async () => {
    const urls = captureRequestUrls()
    await store.listDashboardJobs({ limit: 10, cursor: { total: 70, jobId: '없는-id' } })
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('total.lt.70')
    expect(urls[0]).not.toContain('job_id.lt')
  })

  test('uuid 커서는 동점 비교 항을 그대로 싣는다', async () => {
    const urls = captureRequestUrls()
    const jobId = '11111111-2222-3333-4444-555555555555'
    await store.listDashboardJobs({ limit: 10, cursor: { total: 70, jobId } })
    expect(decodeURIComponent(urls[0]!)).toContain(`and(total.eq.70,job_id.lt.${jobId})`)
  })
})

// 계약 테스트(MemoryStore)로는 실 스토어가 어떤 질의를 내보내는지 알 수 없고,
// 라이브 스위트는 게이트 오프다. 운영에서 깨졌던 두 지점만 나가는 요청으로 고정한다.
describe('SupabaseStore.listUnscoredJobs', () => {
  test('first_seen_at 동률을 id로 갈라 상한이 달라도 같은 앞부분을 준다', async () => {
    const urls = captureRequestUrls()
    await store.listUnscoredJobs(100)
    // 2차 키가 없으면 운영(168행 전부 같은 first_seen_at)에서 limit=5와 limit=100이
    // 서로 다른 앞부분을 냈다.
    expect(decodeURIComponent(urls[0]!)).toContain('order=first_seen_at.asc,id.asc')
  })

  test('총량은 상한이 아니라 서버가 센 전체 건수다', async () => {
    const rows = Array.from({ length: 2 }, (_, i) => ({
      id: `id-${i}`, company_name: 'c', position: 'p',
      url: 'u', due_time: null, first_seen_at: '2026-08-15T10:50:22.397602+00:00',
    }))
    captureRequestUrls(JSON.stringify(rows), { 'content-range': '0-1/137' })
    const page = await store.listUnscoredJobs(2)
    expect(page.rows).toHaveLength(2)
    expect(page.total).toBe(137)
  })
})

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

/**
 * listDashboardJobs의 버킷 이어붙이기(비제외 버킷이 limit보다 짧으면 제외 버킷을
 * 추가로 부른다)를 확인하려면 호출마다 다른 응답이 필요하다 — captureRequestUrls는
 * 매 호출에 같은 본문을 준다.
 */
function captureRequestUrlsSequential(bodies: string[]): string[] {
  const urls: string[] = []
  let call = 0
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0]) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const body = bodies[Math.min(call, bodies.length - 1)]!
    call += 1
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return urls
}

const dashboardRow = (id: string, hidden: boolean) => ({
  total: 50, breakdown: {}, notified_at: null, summary: '',
  jobs: { id, company_name: 'c', position: 'p', url: 'u', due_time: null, bookmarked: false, hidden },
})

afterEach(() => { vi.unstubAllGlobals() })

describe('SupabaseStore는 uuid가 아닌 id에 MemoryStore와 같은 답을 준다', () => {
  test('getJobDetail은 질의하지 않고 null을 준다', async () => {
    await expect(store.getJobDetail('없는-id')).resolves.toBeNull()
  })

  test('setJobBookmarked는 질의하지 않고 조용히 넘어간다', async () => {
    await expect(store.setJobBookmarked('없는-id', true)).resolves.toBeUndefined()
  })

  // cursor.hidden: true를 써서 단일 버킷 호출로 고정한다 — hidden: false로 두면
  // 기본 스텁([])이 항상 limit보다 짧게 와서 버킷 이어붙이기(아래 describe)가
  // 끼어들어 동점 비교 항 자체를 확인하려는 이 테스트의 URL 개수가 흔들린다.
  test('커서의 jobId가 uuid가 아니면 동점 비교 항을 빼고 질의한다', async () => {
    const urls = captureRequestUrls()
    await store.listDashboardJobs({ limit: 10, cursor: { hidden: true, total: 70, jobId: '없는-id' } })
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('total.lt.70')
    expect(urls[0]).not.toContain('job_id.lt')
  })

  test('uuid 커서는 동점 비교 항을 그대로 싣는다', async () => {
    const urls = captureRequestUrls()
    const jobId = '11111111-2222-3333-4444-555555555555'
    await store.listDashboardJobs({ limit: 10, cursor: { hidden: true, total: 70, jobId } })
    expect(decodeURIComponent(urls[0]!)).toContain(`and(total.eq.70,job_id.lt.${jobId})`)
  })
})

// 라이브 스위트가 게이트 오프라 postgrest-js가 실제로 만드는 쿼리 문자열은 이렇게
// fetch를 가로채는 수밖에 확인할 수 없다. hidden 3단 커서는 처음에 order()/or()에
// jobs.hidden을 섞어 한 질의로 풀려 했으나, 로컬 dev 서버로 운영 데이터를 실제로
// 조회해보니 PostgREST의 or()/and() 로직 트리 파서가 임베드 컬럼 참조를 받지 못하고
// "failed to parse logic tree"로 400을 냈다 — MemoryStore 계약 테스트만으로는 이
// SupabaseStore 전용 실패를 잡을 수 없었다. 그래서 hidden=false/true 버킷을 각각
// 기존 2단(total, job_id) 질의로 따로 물어 이어 붙이는 방식으로 바꿨다.
describe('SupabaseStore.listDashboardJobs의 hidden 버킷 이어붙이기', () => {
  test('비제외(hidden=false) 버킷 질의에는 jobs.hidden=eq.false가 붙는다', async () => {
    const urls = captureRequestUrls()
    await store.listDashboardJobs({ limit: 10 })
    expect(decodeURIComponent(urls[0]!)).toContain('jobs.hidden=eq.false')
  })

  test('커서가 이미 제외(hidden=true) 구간이면 질의 한 번으로 끝난다 — 더 채울 버킷이 없다', async () => {
    const urls = captureRequestUrls()
    await store.listDashboardJobs({ limit: 10, cursor: { hidden: true, total: 70, jobId: '11111111-2222-3333-4444-555555555555' } })
    expect(urls).toHaveLength(1)
    expect(decodeURIComponent(urls[0]!)).toContain('jobs.hidden=eq.true')
  })

  test('비제외 버킷이 limit보다 적게 오면 제외 버킷을 이어서 부른다', async () => {
    const urls = captureRequestUrlsSequential([
      JSON.stringify([dashboardRow('11111111-1111-1111-1111-111111111111', false)]),
      JSON.stringify([dashboardRow('22222222-2222-2222-2222-222222222222', true)]),
    ])
    const page = await store.listDashboardJobs({ limit: 10 })
    expect(urls).toHaveLength(2)
    expect(decodeURIComponent(urls[0]!)).toContain('jobs.hidden=eq.false')
    // 첫 버킷이 1행만 줘서 limit(10)에 9행 모자란다 — 두 번째 호출은 그 나머지만 청한다.
    expect(decodeURIComponent(urls[1]!)).toContain('jobs.hidden=eq.true')
    expect(decodeURIComponent(urls[1]!)).toContain('limit=9')
    // 합쳐진 결과의 hidden 플래그가 각 버킷의 값을 그대로 반영한다.
    expect(page.rows.map((r) => r.hidden)).toEqual([false, true])
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

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
    await store.listDashboardJobs({
      limit: 10, cursor: { hidden: false, duplicates: false, total: 70, jobId: '없는-id' },
    })
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('total.lt.70')
    expect(urls[0]).not.toContain('job_id.lt')
  })

  test('uuid 커서는 동점 비교 항을 그대로 싣는다', async () => {
    const urls = captureRequestUrls()
    const jobId = '11111111-2222-3333-4444-555555555555'
    await store.listDashboardJobs({
      limit: 10, cursor: { hidden: false, duplicates: false, total: 70, jobId },
    })
    expect(decodeURIComponent(urls[0]!)).toContain(`and(total.eq.70,job_id.lt.${jobId})`)
  })
})

// 라이브 스위트가 게이트 오프라 postgrest-js가 실제로 만드는 쿼리 문자열은 이렇게
// fetch를 가로채는 수밖에 확인할 수 없다. 목록이 제외 여부로 갈린 뒤로는 질의가
// 한 번이면 되지만, `jobs.hidden` 필터가 임베드 컬럼에 걸린다는 점은 그대로라
// 나가는 문자열을 고정해 둔다(계약 테스트는 MemoryStore만 돌아 이 자리를 못 잡는다).
describe('SupabaseStore.listDashboardJobs의 hidden 필터', () => {
  test('기본은 jobs.hidden=eq.false로 한 번만 묻는다', async () => {
    const urls = captureRequestUrlsSequential([
      JSON.stringify([dashboardRow('11111111-1111-1111-1111-111111111111', false)]),
      JSON.stringify([]), // 회사 별점
    ])
    await store.listDashboardJobs({ limit: 10 })
    // 목록 질의 + 별점 질의, 둘뿐이다. 예전의 두 버킷 이어붙이기는 사라졌다.
    expect(urls).toHaveLength(2)
    expect(decodeURIComponent(urls[0]!)).toContain('jobs.hidden=eq.false')
    expect(decodeURIComponent(urls[1]!)).toContain('company_ratings')
  })

  test('hiddenOnly면 jobs.hidden=eq.true로 묻는다', async () => {
    const urls = captureRequestUrls()
    await store.listDashboardJobs({ limit: 10, hiddenOnly: true })
    expect(decodeURIComponent(urls[0]!)).toContain('jobs.hidden=eq.true')
  })

  // 토글을 바꾸면 이전 목록의 커서가 남는다. 그대로 태우면 반대편 목록의 앞부분이
  // 통째로 잘려 나간다 — 소속이 다른 커서는 질의에 싣지 않아야 한다.
  test('반대편 목록의 커서는 질의에 싣지 않는다', async () => {
    const urls = captureRequestUrls()
    await store.listDashboardJobs({
      limit: 10, hiddenOnly: true,
      cursor: {
        hidden: false, duplicates: false, total: 70, jobId: '11111111-2222-3333-4444-555555555555',
      },
    })
    expect(decodeURIComponent(urls[0]!)).not.toContain('total.lt.70')
  })
})

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

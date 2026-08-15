import { createSupabaseStore } from '@job-finder/db'
import { runCollect } from '@job-finder/graph'
import { createWantedSource, parseWantedSearchUrl } from '@job-finder/sources'

const DETAIL_BATCH = 25

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} 가 필요합니다 (.env.local 확인)`)
  return value
}

async function main() {
  const source = createWantedSource()

  // --url 이 주어지면 검색을 먼저 등록한다 (최초 1회용). 이 경로는 SQL만 출력하고
  // DB에 접속하지 않으므로, Supabase store는 아래에서 이 분기를 지난 뒤에 만든다 —
  // 그래야 --url 모드가 Supabase 자격 증명 없이도 동작한다.
  const urlArg = process.argv.indexOf('--url')
  if (urlArg !== -1) {
    const url = process.argv[urlArg + 1]
    if (!url) throw new Error('--url 뒤에 Wanted 검색 URL이 필요합니다')
    const params = parseWantedSearchUrl(url)
    console.log('검색 등록:', JSON.stringify(params))
    console.log(
      'Supabase SQL Editor에서 실행하세요:\n' +
      `insert into searches (url, params) values (${quote(url)}, ${quote(JSON.stringify(params))}::jsonb);`,
    )
    return
  }

  const store = createSupabaseStore(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  )

  const searches = await store.listEnabledSearches()
  if (searches.length === 0) {
    console.error('활성 검색이 없습니다. 먼저 --url 로 등록 SQL을 만들어 실행하세요.')
    process.exitCode = 1
    return
  }
  console.log(`활성 검색 ${searches.length}건으로 백필을 시작합니다.`)

  let round = 0
  let totalDetailed = 0
  while (true) {
    round++
    const report = await runCollect({ store, source }, 'cli', { detailLimit: DETAIL_BATCH })
    totalDetailed += report.detailed
    console.log(
      `[round ${round}] found=${report.found} created=${report.created} ` +
      `detailed=${report.detailed} failed=${report.failed.length}`,
    )
    for (const f of report.failed) {
      console.warn(`  ! [${f.node}] ${f.itemId}: ${f.code} ${f.message} (retryable=${f.retryable})`)
    }
    // detailed === 0 && !hitDetailLimit만으로는 부족하다: 마지막 배치가 limit보다
    // 작은 채로(hitDetailLimit=false) 전부 일시 실패하면(detailed=0) 재시도할 건이
    // 남아있는데도 여기서 멈추게 된다. listJobsNeedingDetail로 실제로 남은 게
    // 있는지 확인하고 있으면 계속한다 — 재시도 상한(3회)에 도달한 건은 이 조회에서
    // 자동으로 빠지므로(detail_status='failed'로 전환), 루프는 결국 끝난다.
    if (report.detailed === 0 && !report.hitDetailLimit) {
      const stillPending = await store.listJobsNeedingDetail(1)
      if (stillPending.length === 0) break
    }
  }

  const stillPending = await store.listJobsNeedingDetail(1)
  console.log(
    `\n백필 완료. 상세 처리 ${totalDetailed}건.\n` +
    (stillPending.length === 0
      ? '재시도 가능한 대기 건 없음.'
      : '재시도 가능한 대기 건이 남아있음 — pnpm backfill을 다시 실행하면 이어서 처리됩니다.') +
    '\n(참고: 이 조회는 재시도 상한(3회)에 도달해 detail_status=\'failed\'로 넘어간 건은 ' +
    '보여주지 않는다 — 그 목록은 jobs 테이블에서 detail_status=\'failed\'를 직접 조회해야 한다.)',
  )
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

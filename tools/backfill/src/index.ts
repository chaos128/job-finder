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
  const store = createSupabaseStore(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  )
  const source = createWantedSource()

  // --url 이 주어지면 검색을 먼저 등록한다 (최초 1회용).
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
      console.warn(`  ! ${f.itemId}: ${f.code} ${f.message} (retryable=${f.retryable})`)
    }
    if (report.detailed === 0 && !report.hitDetailLimit) break
  }

  const remaining = await store.listJobsNeedingDetail(1)
  console.log(
    `\n백필 완료. 상세 처리 ${totalDetailed}건, ` +
    `남은 대기 ${remaining.length === 0 ? '없음' : '있음 (재시도 상한 도달분 확인 필요)'}`,
  )
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import type { SearchParams } from '@job-finder/db'
import type { ExternalRef, JobSource, RawDetail } from '../types.js'
import { absolute, getJson } from './client.js'
import { normalizeWantedDetail, parseListPage } from './normalize.js'
import { buildWantedListUrl, parseWantedSearchUrl } from './parse-url.js'

const PAGE_SIZE = 100
/** 무한 루프 방지. 100건 × 50 = 5000건이면 어떤 검색 조건도 덮는다. */
const MAX_PAGES = 50

export function createWantedSource(fetchImpl: typeof fetch = fetch): JobSource {
  return {
    id: 'wanted',
    parseSearchUrl: parseWantedSearchUrl,

    async *listRefs(params: SearchParams): AsyncIterable<ExternalRef> {
      let url = buildWantedListUrl(params, { limit: PAGE_SIZE, offset: 0 })
      for (let page = 0; page < MAX_PAGES; page++) {
        const payload = await getJson(url, fetchImpl)
        const { refs, nextPath } = parseListPage(payload)
        for (const ref of refs) yield ref
        if (!nextPath) return
        url = absolute(nextPath)
      }
    },

    async fetchDetail(externalId: string): Promise<RawDetail> {
      const payload = await getJson(
        `https://www.wanted.co.kr/api/v4/jobs/${externalId}`,
        fetchImpl,
      )
      return { externalId, payload }
    },

    normalize: normalizeWantedDetail,
  }
}

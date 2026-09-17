import type { SearchParams } from '@job-finder/db'
import type { ExternalRef, JobSource, RawDetail } from '../types.js'
import { RememberHttpError, getRememberJson, postJson } from './client.js'
import {
  NO_QUERY_ECHO, normalizeRememberDetail, parseRememberListPage, parseRememberOpenState,
} from './normalize.js'
import {
  REMEMBER_API_BASE, buildRememberSearchBody, parseRememberSearchUrl,
} from './parse-url.js'

/** 화면 기본값과 같다. 122건이면 5페이지다. */
const PAGE_SIZE = 30
/** 무한 루프 방지. total_pages를 믿되 상한은 둔다 — 30 × 50 = 1500건. */
const MAX_PAGES = 50

export function createRememberSource(fetchImpl: typeof fetch = fetch): JobSource {
  return {
    id: 'remember',
    parseSearchUrl: parseRememberSearchUrl,

    async *listRefs(params: SearchParams): AsyncIterable<ExternalRef> {
      if (params.source !== 'remember') {
        throw new Error(`remember 소스에 ${params.source} 파라미터가 왔습니다`)
      }
      for (let page = 1; page <= MAX_PAGES; page++) {
        const payload = await postJson(
          `${REMEMBER_API_BASE}/job_postings/search`,
          buildRememberSearchBody(params, { page, per: PAGE_SIZE }),
          fetchImpl,
        )
        const parsed = parseRememberListPage(payload)

        // 필터 이름이 틀리면 API는 400이 아니라 그 필터를 무시하고 200을 준다.
        // 그대로 두면 조건에 맞지 않는 전량(실측 12,894건)이 수집된다.
        // 422처럼 영구 실패로 분류한다 — 재시도해도 같은 본문이라 같은 결과다.
        if (parsed.ignoredFilters.length > 0) {
          const isNoEcho =
            parsed.ignoredFilters.length === 1 && parsed.ignoredFilters[0] === NO_QUERY_ECHO
          // NO_QUERY_ECHO는 "서버가 이 필터를 무시했다"가 아니라 "검증할 방법이
          // 없었다"는 뜻이다. 같은 문구로 묶으면 크론 로그를 보는 사람이 존재하지도
          // 않는 필터 이름을 의심하게 된다 — 원인이 다르므로 메시지도 갈라야 한다.
          const message = isNoEcho
            ? 'Remember 응답에 필터 검증용 에코(logger_info)가 없어 필터가 반영됐는지 ' +
              '확인할 수 없습니다. 안전을 위해 수집을 중단합니다.'
            : `Remember가 필터를 무시했습니다: ${parsed.ignoredFilters.join(', ')} ` +
              '(본문 키가 snake_case인지 확인하라)'
          throw new RememberHttpError(422, message)
        }

        for (const ref of parsed.refs) yield ref
        if (parsed.page >= parsed.totalPages) return
      }
    },

    async fetchDetail(externalId: string): Promise<RawDetail> {
      const payload = await getRememberJson(
        `${REMEMBER_API_BASE}/job_postings/${externalId}`,
        fetchImpl,
      )
      return { externalId, payload }
    },

    normalize: normalizeRememberDetail,
    parseOpenState: parseRememberOpenState,
  }
}

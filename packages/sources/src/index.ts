export * from './types.js'
export { normalizeDueTime } from './date.js'
export { SourceHttpError } from './http.js'
export { MAX_YEARS, buildWantedListUrl, parseWantedSearchUrl } from './wanted/parse-url.js'
export { normalizeWantedDetail, parseJobOpenState, parseListPage } from './wanted/normalize.js'
export { WantedHttpError, absolute, getJson } from './wanted/client.js'
export { createWantedSource } from './wanted/index.js'
export { BlindHttpError, findCompanyRating, parseSearchPage, searchCandidates, type BlindCompany } from './blind/index.js'
export {
  REMEMBER_API_BASE, REMEMBER_JOB_URL_BASE,
  buildRememberSearchBody, parseRememberSearchUrl,
} from './remember/parse-url.js'
export { RememberHttpError, getRememberJson, postJson } from './remember/client.js'
export { normalizeRememberDetail, parseRememberListPage, parseRememberOpenState } from './remember/normalize.js'

import type { SourceRegistry } from './types.js'
import { createWantedSource } from './wanted/index.js'

/** 운영에서 쓰는 소스 표. 호출부는 이 하나만 알면 된다. */
export function createSourceRegistry(fetchImpl: typeof fetch = fetch): SourceRegistry {
  return { wanted: createWantedSource(fetchImpl) }
}

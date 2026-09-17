import { SourceHttpError } from '../http.js'

const ORIGIN = 'https://career.rememberapp.co.kr'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36'

/** wanted/client.ts와 같은 값·같은 이유 — undici 기본값(300초)이면 Vercel 함수가
 * maxDuration(60초)에 먼저 죽어 실패 기록이 남지 않는다. */
const REQUEST_TIMEOUT_MS = 15_000

export class RememberHttpError extends SourceHttpError {
  constructor(status: number, message: string) {
    super(status, message)
    this.name = 'RememberHttpError'
  }
}

async function request(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetchImpl(url, {
      ...init,
      headers: {
        'User-Agent': UA,
        Origin: ORIGIN,
        Referer: `${ORIGIN}/`,
        Accept: 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new RememberHttpError(0, `네트워크 실패: ${String(cause)}`)
  }
  if (!res.ok) {
    throw new RememberHttpError(res.status, `${res.status} ${res.statusText} — ${url}`)
  }
  try {
    return await res.json()
  } catch (cause) {
    throw new RememberHttpError(502, `JSON 파싱 실패 (HTTP ${res.status}) — ${url}: ${String(cause)}`)
  }
}

export function postJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, fetchImpl)
}

export function getRememberJson(url: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  return request(url, { method: 'GET' }, fetchImpl)
}

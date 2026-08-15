const ORIGIN = 'https://www.wanted.co.kr'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36'

export class WantedHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'WantedHttpError'
  }
  /** 5xx·429·타임아웃만 재시도 가치가 있다. 404/422는 영구 실패. */
  get retryable() {
    return this.status >= 500 || this.status === 429 || this.status === 0
  }
}

export async function getJson(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Referer: `${ORIGIN}/`, Accept: 'application/json' },
    })
  } catch (cause) {
    throw new WantedHttpError(0, `네트워크 실패: ${String(cause)}`)
  }
  if (!res.ok) {
    throw new WantedHttpError(res.status, `${res.status} ${res.statusText} — ${url}`)
  }
  try {
    return await res.json()
  } catch (cause) {
    // 2xx인데 JSON이 아닌 본문(예: 봇 차단 인터스티셜 HTML)은 영구 실패보다 일시적 차단일 가능성이 높다.
    // 5xx로 분류해 재시도 가치가 있다고 표시한다.
    throw new WantedHttpError(502, `JSON 파싱 실패 (HTTP ${res.status}) — ${url}: ${String(cause)}`)
  }
}

export function absolute(path: string): string {
  return path.startsWith('http') ? path : `${ORIGIN}${path}`
}

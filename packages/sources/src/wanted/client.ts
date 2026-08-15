const ORIGIN = 'https://www.wanted.co.kr'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36'

/** 응답이 이 시간을 넘기면 끊는다 — 그냥 두면 undici 기본값(300초)이라
 * Vercel 함수가 maxDuration(60초)에 먼저 죽고, 그러면 recordDetailFailure에
 * 도달하지 못해 detail_attempts가 오르지 않는다. 3회 상한이라는 유일한 보호
 * 장치가 무력해져 매일 같은 항목에서 같은 방식으로 죽는다.
 * mailer(send.ts)의 20초와 같은 방식이고, 여기는 건별 호출이라 더 짧게 잡았다. */
const REQUEST_TIMEOUT_MS = 15_000

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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    // abort도 여기로 온다 — status 0이라 retryable로 분류되고, attempts가 올라
    // 3회 후에는 그 공고가 대기 목록에서 빠진다.
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

/**
 * 소스 공용 HTTP 오류. 그래프 노드는 이 타입으로만 검사한다 — 소스마다 다른
 * 오류 클래스를 노드가 알아야 하면, 소스를 하나 더 붙일 때마다 노드 세 개를
 * 같이 고쳐야 한다(그리고 안 고치면 조용히 retryable=false로 떨어진다).
 */
export class SourceHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'SourceHttpError'
  }
  /** 5xx·429·타임아웃(status 0)만 재시도 가치가 있다. 404/422는 영구 실패. */
  get retryable() {
    return this.status >= 500 || this.status === 429 || this.status === 0
  }
}

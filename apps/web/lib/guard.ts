/**
 * Bearer 토큰을 검증한다. 통과하면 null, 실패하면 그대로 반환할 Response.
 * expected가 비어 있으면 설정 실수이므로 500으로 막는다 — 열어두지 않는다.
 */
export function requireBearer(req: Request, expected: string | undefined): Response | null {
  if (!expected) {
    return Response.json({ error: 'server misconfigured: token not set' }, { status: 500 })
  }
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (token !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

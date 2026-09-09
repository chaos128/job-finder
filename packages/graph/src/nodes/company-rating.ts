import type { Store } from '@job-finder/db'
import { BlindHttpError, type BlindCompany } from '@job-finder/sources'
import { fail, ok, type Node, type NodeResult } from '../core/node.js'

/**
 * 회사명 → Blind 별점. 실제 구현은 sources의 findCompanyRating이고, 테스트는
 * 스텁을 넣는다 — 주입하지 않으면 collect 테스트가 매번 teamblind.com을 두드린다.
 */
export type FindRating = (companyName: string) => Promise<BlindCompany | null>

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 회사명 하나에 대해 Blind 별점을 찾아 기록한다.
 *
 * 미등록(검색 결과에 회사가 없음)은 실패가 아니라 **확정된 답**이라 ok로 저장한다.
 * 실패로 다루면 매 실행이 없는 회사를 영원히 다시 조회하는데, 실측 커버리지가
 * 73%라 그 대상이 회사 넷 중 하나꼴이다.
 */
export function createCompanyRatingNode(
  deps: { store: Store; findRating: FindRating },
): Node<string, string> {
  return {
    name: 'companyRating',

    async run(companyName): Promise<NodeResult<string>> {
      let hit: BlindCompany | null
      try {
        hit = await deps.findRating(companyName)
      } catch (cause) {
        const retryable = cause instanceof BlindHttpError ? cause.retryable : true
        try {
          await deps.store.recordCompanyRatingFailure(companyName, messageOf(cause))
        } catch {
          // 관측 손실일 뿐이다 — 원래 실패를 그대로 보고한다(fetch-detail과 같은 규약).
        }
        return fail('BLIND_FETCH', messageOf(cause), retryable)
      }

      try {
        await deps.store.saveCompanyRating(hit
          ? {
            companyName, status: 'ok',
            rating: hit.rating, blindName: hit.name, blindUrl: hit.url,
          }
          : { companyName, status: 'not_found' })
        return ok(companyName)
      } catch (cause) {
        return fail('STORE_FAILED', messageOf(cause), true)
      }
    },
  }
}

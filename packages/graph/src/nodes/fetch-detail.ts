import type { Job, Store } from '@job-finder/db'
import { SourceHttpError, type JobSource, type SourceRegistry } from '@job-finder/sources'
import { fail, ok, type Node, type NodeResult } from '../core/node.js'

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 실패 사유를 store에 기록하고 그 결과를 반환한다. recordDetailFailure 자체가
 * 실패해도(store 장애) 원래 실패 사유를 그대로 보고한다 — 시도 횟수가 이번엔
 * 못 올라가지만, pending으로 남아 다음 실행에서 다시 시도되므로 안전하다.
 * 이중 실패로 헷갈리게 하거나 unhandled rejection을 내는 것보다 낫다.
 */
async function reportFailure(
  store: Store,
  jobId: string,
  code: string,
  message: string,
  retryable: boolean,
): Promise<NodeResult<never>> {
  try {
    await store.recordDetailFailure(jobId, `${code}: ${message}`)
  } catch {
    // 관측 손실일 뿐이다 — 원래 실패를 아래에서 그대로 보고한다.
  }
  return fail(code, message, retryable)
}

export function createFetchDetailNode(
  deps: { store: Store; sources: SourceRegistry },
): Node<Job, string> {
  return {
    name: 'fetchDetail',

    async run(job) {
      // reportFailure(→ recordDetailFailure)가 아니라 바로 fail한다: 이건 이 공고를
      // 몇 번 다시 가져와도 똑같이 실패할 소스 문제가 아니라 아직 배포되지 않은
      // 레지스트리 문제다. attempts를 올리면 배포 후에도 3회 만에 detail_status가
      // 'failed'로 굳어 이 공고가 영영 재수집되지 않는다 — discover/recheck와
      // 같은 모양으로 둔다.
      const source = deps.sources[job.source]
      if (!source) return fail('UNKNOWN_SOURCE', `등록되지 않은 소스: ${job.source}`, false)

      let raw: Awaited<ReturnType<JobSource['fetchDetail']>>
      try {
        raw = await source.fetchDetail(job.externalId)
      } catch (cause) {
        const retryable = cause instanceof SourceHttpError ? cause.retryable : false
        return reportFailure(deps.store, job.id, 'SOURCE_HTTP', messageOf(cause), retryable)
      }

      let fields: ReturnType<JobSource['normalize']>
      try {
        fields = source.normalize(raw)
      } catch (cause) {
        return reportFailure(deps.store, job.id, 'NORMALIZE_FAILED', messageOf(cause), false)
      }

      try {
        await deps.store.saveJobDetail(job.id, fields)
        return ok(job.id)
      } catch (cause) {
        return reportFailure(deps.store, job.id, 'STORE_FAILED', messageOf(cause), true)
      }
    },
  }
}

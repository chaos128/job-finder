'use client'

import type { DuplicateJobs } from '@job-finder/db'
import { Badge } from '@job-finder/ui'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { errorText } from '@/lib/dashboard'
import { loadDuplicateJobs } from '../actions'
import { markDetailNavigation } from './list-cache'
import { sourceLabel } from './source-label'

/**
 * 중복으로 표시된 공고. 점수 목록이 아니라 별도 조회인 이유는 중복이 채점 큐에서
 * 빠져 점수 행이 영영 생기지 않기 때문이다 — 점수에서 출발하는 목록으로는 낼 수 없다.
 * 그래서 미채점 목록과 같은 모양(토글 시 한 번만 불러오고, 페이징 없음)을 따른다.
 *
 * 이 화면이 존재하는 이유: 중복 판정은 휴리스틱이고 되돌리는 경로가 SQL뿐이라,
 * 사람이 오탐을 알아볼 창이 없으면 행을 지우지 않고 남긴 의미가 사라진다.
 * 그래서 원본으로 가는 링크가 핵심이다 — 나란히 놓고 봐야 판정이 맞는지 안다.
 */
export function DuplicateList() {
  const [page, setPage] = useState<DuplicateJobs | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadDuplicateJobs()
      .then((data) => { if (!cancelled) setPage(data) })
      .catch((e) => { if (!cancelled) setError(errorText(e)) })
    return () => { cancelled = true }
  }, [])

  const rows = page?.rows ?? null
  const total = page?.total ?? 0
  const truncated = rows !== null && total > rows.length

  return (
    <section className="space-y-3 border-t border-neutral-200 pt-6">
      <h2 className="text-lg font-medium">
        중복 {total}건
        {truncated && (
          <span className="ml-2 text-sm font-normal text-neutral-400">
            오래된 순 {rows.length}건만 표시
          </span>
        )}
      </h2>

      <p className="text-sm text-neutral-500">
        다른 사이트에 이미 있는 공고로 판정돼 채점·알림에서 빠진 것이다.
        잘못 묶였으면 원본과 대조해 확인할 수 있다.
      </p>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {!error && rows === null && (
        <p className="text-sm text-neutral-400">불러오는 중…</p>
      )}

      {!error && rows !== null && rows.length === 0 && (
        <p className="text-sm text-neutral-400">중복으로 표시된 공고가 없다.</p>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.jobId}
              className="flex items-start gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <div className="w-14 shrink-0 text-center text-sm font-medium text-neutral-400">
                중복
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {/* 이 공고 자체는 점수가 없어 상세 페이지가 404다 — 원본 사이트로 보낸다. */}
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block hover:underline"
                >
                  <div className="text-sm text-neutral-500">{row.companyName}</div>
                  <div className="truncate text-lg font-medium">{row.position}</div>
                </a>
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                  <Badge>{sourceLabel(row.source)}</Badge>
                  <span>{row.dueTime ? `마감 ${row.dueTime}` : '상시채용'}</span>
                  <Badge>수집 {row.firstSeenAt}</Badge>
                  {/* 원본은 채점됐으므로 상세 페이지가 열린다. */}
                  <Link
                    href={`/jobs/${row.duplicateOf}`}
                    onClick={markDetailNavigation}
                    className="text-neutral-500 underline"
                  >
                    원본 보기
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

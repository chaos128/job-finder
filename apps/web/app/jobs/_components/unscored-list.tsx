'use client'

import type { UnscoredJob } from '@job-finder/db'
import { Badge } from '@job-finder/ui'
import { useEffect, useState } from 'react'
import { loadUnscoredJobs } from '../actions'

/**
 * 토글이 켜질 때 한 번만 불러온다. 점수가 없어 getJobDetail이 null(404)을
 * 주므로 상세 페이지로는 링크하지 않는다 — 원티드 원본 링크만 건다.
 */
export function UnscoredList() {
  const [rows, setRows] = useState<UnscoredJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadUnscoredJobs()
      .then((data) => { if (!cancelled) setRows(data) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [])

  return (
    <section className="space-y-3 border-t border-neutral-200 pt-6">
      <h2 className="text-lg font-medium">
        채점 대기 {rows ? rows.length : 0}건
      </h2>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {!error && rows === null && (
        <p className="text-sm text-neutral-400">불러오는 중…</p>
      )}

      {!error && rows !== null && rows.length === 0 && (
        <p className="text-sm text-neutral-400">모두 채점됐다.</p>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.jobId}
              className="flex items-start gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <div className="w-14 shrink-0 text-center text-sm font-medium text-neutral-400">
                미채점
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block hover:underline"
                >
                  <div className="text-sm text-neutral-500">{row.companyName}</div>
                  <div className="truncate text-lg font-medium">{row.position}</div>
                </a>
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <span>{row.dueTime ? `마감 ${row.dueTime}` : '상시채용'}</span>
                  <Badge>수집 {row.firstSeenAt}</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

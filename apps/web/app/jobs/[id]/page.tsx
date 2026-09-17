import { getStore } from '@/lib/store'
import { cn } from '@job-finder/ui'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BlindRating } from '../_components/blind-rating'
import { formatExperience } from '../_components/experience'
import { BookmarkToggle } from '../_components/bookmark-toggle'
import { ScoreBars } from '../_components/score-bars'
import { scoreBandClass } from '../_components/score-visuals'

export const dynamic = 'force-dynamic'

function Section({ title, body }: { title: string; body: string | null | undefined }) {
  if (!body) return null
  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-500">{title}</h2>
      <p className="mt-2 whitespace-pre-wrap leading-relaxed">{body}</p>
    </section>
  )
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getStore().getJobDetail(id)
  if (!detail) notFound()
  const { job, score, blind } = detail

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <Link href="/jobs" className="text-sm text-neutral-500 hover:underline">← 목록</Link>

      <header className="space-y-1">
        {/* 카드와 같은 이유로 굵기·크기를 올렸다 — 어느 회사인지가 muted 캡션으로
            묻히면 안 된다. h1(text-2xl bold)이 여전히 우세하므로 위계는 유지된다. */}
        <div className="flex items-center gap-2">
          <div className="text-lg font-semibold text-neutral-700">{job.companyName}</div>
          <BlindRating blind={blind} size="md" />
          {/* 카드와 같은 배지 — 두 출처가 섞여 있어 상세에서도 어디서 온 공고인지 보여야 한다. */}
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
            {job.source === 'remember' ? '리멤버' : '원티드'}
          </span>
          {job.duplicateOf && (
            <Link href={`/jobs/${job.duplicateOf}`} className="text-xs text-neutral-500 underline">
              원본 보기
            </Link>
          )}
        </div>
        <h1 className="text-2xl font-bold">{job.position}</h1>
        <div className="flex items-center gap-4 pt-2">
          {/* KPI 타일과 같은 크기 위계(text-3xl font-semibold tabular-nums). 색 밴드는 카드와 동일 기준. */}
          <span className={cn('text-3xl font-semibold tabular-nums', scoreBandClass(score.total))}>
            {score.total}
          </span>
          {/* 북마크 여부는 공고 전문을 읽고 나서 정해진다 — 목록보다 여기가 제자리다. */}
          <BookmarkToggle jobId={job.id} initial={job.bookmarked} />
          <a href={job.url} target="_blank" rel="noreferrer"
            className="rounded-full border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100">
            원티드에서 보기
          </a>
        </div>
      </header>

      <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <ScoreBars breakdown={score.breakdown} />
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{score.reasoning}</p>
        <div className="text-xs text-neutral-400">
          {score.rubricVersion} · {score.scoredAt.slice(0, 10)} 채점 · {score.scorer}
        </div>
      </div>

      <div className="space-y-6">
        <Section title="회사 소개" body={job.intro} />
        <Section title="주요 업무" body={job.mainTasks} />
        <Section title="자격 요건" body={job.requirements} />
        <Section title="우대 사항" body={job.preferredPoints} />
        <Section title="복지" body={job.benefits} />
        {job.skillTags?.length ? (
          <section>
            <h2 className="text-sm font-semibold text-neutral-500">기술 태그</h2>
            <p className="mt-2 text-sm">{job.skillTags.join(' · ')}</p>
          </section>
        ) : null}
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          {/* 카드와 같은 순서·같은 규칙으로 둔다. */}
          {formatExperience(job.annualFrom ?? null, job.annualTo ?? null) && (
            <span>{formatExperience(job.annualFrom ?? null, job.annualTo ?? null)}</span>
          )}
          <span>{job.dueTime ? `마감 ${job.dueTime}` : '상시채용'}</span>
        </div>
      </div>
    </main>
  )
}

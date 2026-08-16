import { getStore } from '@/lib/store'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ScoreBars } from '../_components/score-bars'

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
  const { job, score } = detail

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">← 목록</Link>

      <header className="space-y-1">
        <div className="text-sm text-neutral-500">{job.companyName}</div>
        <h1 className="text-2xl font-bold">{job.position}</h1>
        <div className="flex items-center gap-4 pt-2">
          <span className="text-4xl font-bold tabular-nums">{score.total}</span>
          <a href={job.url} target="_blank" rel="noreferrer"
            className="rounded border px-3 py-1 text-sm hover:bg-neutral-100">
            원티드에서 보기
          </a>
        </div>
      </header>

      <div className="rounded-lg border border-neutral-200 bg-white p-5 space-y-4">
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
        <div className="text-sm text-neutral-500">
          {job.dueTime ? `마감 ${job.dueTime}` : '상시채용'}
        </div>
      </div>
    </main>
  )
}

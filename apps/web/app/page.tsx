import { getStore } from '@/lib/store'
import Link from 'next/link'
import { StatusStrip } from './_components/status-strip'

export const dynamic = 'force-dynamic'

const STEPS = [
  { when: 'KST 01:00', title: '수집', body: '등록된 검색 조건으로 Wanted를 훑어 새로 올라온 공고만 저장한다. 이미 아는 공고는 건너뛴다.' },
  { when: 'KST 03:00', title: '채점', body: '이력서 프로필과 대조해 5개 축으로 0~100점을 매긴다. 채점은 이 앱이 아니라 외부 Claude Code routine이 한다.' },
  { when: 'KST 09:00', title: '알림', body: '기준을 넘긴 공고를 점수 순으로 골라 다이제스트 메일 한 통으로 보낸다.' },
]

const AXES = [
  ['stack', '기술 스택', '요구 스택이 주력과 얼마나 겹치는가'],
  ['role', '역할·연차', '이 팀이 찾는 연차와 책임 범위가 맞는가'],
  ['domain', '도메인', '해봤고 잘하는 분야인가'],
  ['growth', '회사 성장성', '매출·사용자·투자에 성장 신호가 있는가'],
  ['conditions', '근무 조건', '위치·근무 형태가 선호와 맞는가'],
] as const

export default async function Page() {
  const stats = await getStore().getDashboardStats()

  return (
    <main className="mx-auto max-w-3xl space-y-16 px-6 py-20">
      <header className="space-y-6">
        <h1 className="text-5xl font-bold tracking-tight">Job Finder</h1>
        <p className="text-xl leading-relaxed text-neutral-600">
          Wanted 채용 공고를 매일 훑어 이력서와 대조 채점하고,
          <br />
          좋은 매치가 나오면 아침에 메일 한 통으로 알려준다.
        </p>
        <Link
          href="/jobs"
          className="inline-block rounded-md bg-neutral-900 px-6 py-3 text-white hover:bg-neutral-700"
        >
          채점된 공고 보기 →
        </Link>
      </header>

      <section className="space-y-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">지금 상태</h2>
        <StatusStrip stats={stats} now={new Date()} />
      </section>

      <section className="space-y-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">어떻게 도는가</h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <ol className="space-y-6">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-5">
                <span className="w-8 shrink-0 text-2xl font-bold tabular-nums text-neutral-300">{i + 1}</span>
                <div className="space-y-1">
                  <div className="flex items-baseline gap-3">
                    <h3 className="text-lg font-semibold">{s.title}</h3>
                    <span className="text-xs text-neutral-400">{s.when}</span>
                  </div>
                  <p className="leading-relaxed text-neutral-600">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          무엇으로 채점하는가
        </h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <p className="text-neutral-600">다섯 축에 각각 0~20점, 합쳐서 100점 만점이다.</p>
          <dl className="mt-4 space-y-4">
            {AXES.map(([key, label, desc]) => (
              <div key={key} className="flex gap-4">
                <dt className="w-28 shrink-0">
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-neutral-400">{key}</div>
                </dt>
                <dd className="leading-relaxed text-neutral-600">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <footer className="border-t border-neutral-200 pt-8 text-sm text-neutral-400">
        개인용 서비스입니다. 채점 기준은 소유자의 이력서와 선호 조건에 맞춰져 있습니다.
      </footer>
    </main>
  )
}

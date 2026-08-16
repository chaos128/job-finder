import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-bold">공고를 찾을 수 없습니다</h1>
      <p className="mt-2 text-neutral-600">채점되지 않았거나 삭제된 공고입니다.</p>
      <Link href="/jobs" className="mt-4 inline-block underline">목록으로</Link>
    </main>
  )
}

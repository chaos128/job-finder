import type { CompanyRating } from '@job-finder/db'
import { Star } from 'lucide-react'

/**
 * Blind 회사 별점. 미등록 회사는 아무것도 그리지 않는다 — 실측 커버리지가 73%라
 * "없음"을 표시하면 목록 넷 중 하나가 빈 배지로 덮인다.
 *
 * 상세 페이지로 가는 링크 안에 넣을 수 없다(a 중첩은 무효 마크업). 호출하는 쪽에서
 * 회사명 링크와 형제로 두어야 한다.
 */
export function BlindRating({ blind, size = 'sm' }: {
  blind: CompanyRating | null
  size?: 'sm' | 'md'
}) {
  if (!blind) return null
  return (
    <a
      href={blind.blindUrl}
      target="_blank"
      rel="noreferrer"
      // 매칭된 Blind 회사명을 title로 남긴다. 원문과 다를 수 있어서
      // (에스케이일렉링크 → SK일렉링크) 오매칭을 눈으로 잡을 유일한 단서다.
      title={`Blind 평점 ${blind.rating.toFixed(1)} · ${blind.blindName}`}
      className={size === 'md'
        ? 'inline-flex shrink-0 items-center gap-1 rounded-full border border-neutral-300 px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100'
        : 'inline-flex shrink-0 items-center gap-0.5 rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100'}
    >
      <Star className={size === 'md' ? 'size-4 fill-amber-400 text-amber-400' : 'size-3 fill-amber-400 text-amber-400'} />
      <span className="tabular-nums">{blind.rating.toFixed(1)}</span>
    </a>
  )
}

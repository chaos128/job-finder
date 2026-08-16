'use client'

import { Button } from '@job-finder/ui'
import { Bookmark } from 'lucide-react'
import { useState, useTransition } from 'react'
import { errorText } from '@/lib/dashboard'
import { toggleBookmark } from '../actions'

/**
 * 상세는 서버 컴포넌트다(스펙 §3.3) — 페이지를 클라이언트로 내리지 않고 북마크 버튼
 * 하나만 클라이언트 경계로 뗀다. 목록과 같은 규약: 낙관적으로 먼저 뒤집고, 실패하면
 * 되돌린 뒤 알린다. 상세에는 목록의 에러 배너가 없어 실패를 담을 곳이 여기뿐이다.
 */
export function BookmarkToggle({ jobId, initial }: { jobId: string; initial: boolean }) {
  const [bookmarked, setBookmarked] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function onClick() {
    const next = !bookmarked
    setBookmarked(next)
    setError(null)
    startTransition(async () => {
      try {
        await toggleBookmark(jobId, next)
      } catch (e) {
        setBookmarked(!next)
        setError(errorText(e))
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        aria-label={bookmarked ? '북마크 해제' : '북마크'}
        aria-pressed={bookmarked}
        onClick={onClick}
        className="h-auto px-2"
      >
        {/* 채운 북마크 = 켜짐. 아이콘 하나에 fill만 바꿔서 두 상태의 실루엣이
            정확히 겹치게 한다(★/☆ 글리프는 폰트마다 굵기가 달라 흔들렸다). */}
        <Bookmark className={bookmarked ? 'size-6 fill-current' : 'size-6'} />
      </Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  )
}

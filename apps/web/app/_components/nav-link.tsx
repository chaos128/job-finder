'use client'

import { cn } from '@job-finder/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

// 현재 경로 강조에만 usePathname이 필요하다 — 이거 하나 때문에 TopBar 전체를
// 클라이언트 컴포넌트로 내리지 않도록 이 링크만 분리한다.
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname()
  // '/'는 정확히 일치할 때만 — startsWith('/')로 하면 모든 경로가 걸린다.
  // 그 외(예: '/jobs')는 하위 경로('/jobs/[id]')에서도 같은 섹션이니 켜져 있어야 한다.
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100',
      )}
    >
      {children}
    </Link>
  )
}

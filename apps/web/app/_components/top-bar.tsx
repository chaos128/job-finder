import { NavLink } from './nav-link'

/** 세 화면 모두에 걸리는 상단 바. 라우트가 /와 /jobs 둘뿐이라 사이드바 대신 이걸 쓴다. */
export function TopBar() {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <span className="text-sm font-semibold tracking-tight">Job Finder</span>
        <nav className="flex items-center gap-1">
          <NavLink href="/">홈</NavLink>
          <NavLink href="/jobs">공고</NavLink>
        </nav>
      </div>
    </header>
  )
}

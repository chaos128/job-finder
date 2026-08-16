// 'use server' 파일은 async 함수만 export할 수 있어(Next 15 제약) actions.ts에 못 둔다.
// page.tsx와 actions.ts가 같은 페이지 크기를 써야 하므로 별도 파일로 뺀다.
export const PAGE_SIZE = 100
// 미채점 목록은 페이징이 없다 — 하루치 신규 수집분은 적어 상한만 걸면 충분하다.
export const UNSCORED_LIMIT = 100

// 'use server' 파일은 async 함수만 export할 수 있어(Next 15 제약) actions.ts에 못 둔다.
// page.tsx와 actions.ts가 같은 페이지 크기를 써야 하므로 별도 파일로 뺀다.
export const PAGE_SIZE = 100

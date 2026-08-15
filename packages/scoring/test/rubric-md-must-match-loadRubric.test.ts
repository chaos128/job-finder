import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { loadRubric } from '../src/index.js'

// rubric.ts는 프로덕션 빌드에서 파일을 읽지 못하는 문제(import.meta.url이 빌드 시점
// 절대 경로로 박히고, .md는 배포 산출물에 포함되지 않음) 때문에 rubric.md의 내용을
// TS 문자열 상수로 인라인해 loadRubric()이 반환한다. 그 결과 rubric.md는 더 이상
// 런타임에 읽히지 않는 "사람이 보는 사본"이 됐다 — 둘 중 하나만 고치면 두 사본이
// 어긋나고, 채점 에이전트는 아무 에러 없이 구버전 루브릭 기준으로 계속 채점하게 된다.
// 이 테스트는 vitest가 소스에서 직접 실행되는 특성(정확히 rubric.ts가 프로덕션에서
// 실패하는 이유)을 이용해 rubric.md를 읽어 loadRubric()의 출력과 비교한다.
// 이 테스트가 깨지면: rubric.ts의 RUBRIC_MARKDOWN과 rubric.md 중 하나만 고쳤다는 뜻이다 —
// 두 파일을 동일하게 맞출 것.
test('rubric.md와 loadRubric()의 인라인 텍스트가 정확히 일치한다', () => {
  const fileContent = readFileSync(new URL('../src/rubric.md', import.meta.url), 'utf8')
  expect(loadRubric()).toBe(fileContent)
})
